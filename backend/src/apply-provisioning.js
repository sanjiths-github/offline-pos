const fs = require('node:fs');
const { db } = require('./db');

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node src/apply-provisioning.js <client-manifest.json>');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { business, admin, clientId, developerKeyHash } = manifest;
if (manifest.version !== 1 || !/^[a-z0-9-]{3,50}$/.test(clientId) ||
    !business?.name || !business?.ownerName ||
    !/^[a-zA-Z0-9._-]{3,40}$/.test(admin?.username || '') ||
    !/^\$2[aby]\$/.test(admin?.passwordHash || '') ||
    !/^[a-f0-9]{64}$/.test(developerKeyHash || '')) {
  throw new Error('Invalid client provisioning manifest');
}
const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
const existingBusiness = db.prepare('SELECT COUNT(*) AS count FROM businesses').get().count;
if (existing || existingBusiness) {
  console.log('Existing client data found; provisioning skipped.');
  db.close();
  process.exit(0);
}
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare('INSERT INTO businesses(id,name,owner_name,address_line_1,address_line_2,city,state,zip_code,phone,email,tax_id,currency,timezone,default_tax_rate_bps,receipt_footer) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    business.name, business.ownerName, business.addressLine1 || '', business.addressLine2 || '',
    business.city || '', business.state || '', business.zipCode || '', business.phone || '',
    business.email || '', business.taxId || '', business.currency || 'USD',
    business.timezone || 'America/New_York', business.defaultTaxRateBps || 0,
    business.receiptFooter || 'Thank you for your business!');
  const addHours=db.prepare('INSERT INTO business_hours(business_id,day_of_week,is_closed) VALUES(1,?,1)');
  for(let day=0;day<7;day++) addHours.run(day);
  db.prepare("INSERT INTO users(username,password_hash,role,must_change_password) VALUES(?,?,'BUSINESS_ADMIN',1)").run(admin.username,admin.passwordHash);
  db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('client_id',clientId);
  db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('developer_key_hash',developerKeyHash);
  if (manifest.sampleData === true) {
    const categories = [
      ['Coffee', 'Espresso and brewed coffee'], ['Tea', 'Hot and iced tea'],
      ['Breakfast', 'Morning favorites'], ['Bakery', 'Fresh pastries']
    ];
    for (const [name, description] of categories) db.prepare('INSERT INTO categories(name,description) VALUES(?,?)').run(name,description);
    const products = [
      [1, 'Espresso', 350], [1, 'Cappuccino', 525], [1, 'Iced Latte', 575],
      [2, 'English Breakfast Tea', 375], [2, 'Chai Latte', 495],
      [3, 'Breakfast Sandwich', 895], [4, 'Butter Croissant', 425]
    ];
    for (const [categoryId, name, priceCents] of products) db.prepare('INSERT INTO products(category_id,name,price_cents) VALUES(?,?,?)').run(categoryId,name,priceCents);
  }
  db.exec('COMMIT');
  console.log(`Provisioned ${business.name}.`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
