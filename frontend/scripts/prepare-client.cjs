const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { manifestFor } = require('./client-provisioning.cjs');
const { chooseSecrets, saveSecrets } = require('./client-secrets.cjs');
const root = path.join(__dirname, '..');
const branding = path.join(root, 'branding');
const client = JSON.parse(fs.readFileSync(path.join(branding, 'client.json'), 'utf8'));
const username = process.argv[2];
if (!/^[a-z0-9-]{3,50}$/.test(client.clientId)) throw new Error('Set a stable lowercase clientId in branding/client.json');
if (!username || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('Usage: npm run client:prepare -- <admin-username>');
const directory = path.join(root, 'provisioning');
fs.mkdirSync(directory, { recursive: true });
const manifestPath = manifestFor(client.clientId, true);
if (fs.existsSync(manifestPath)) {
  const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (old.clientId === client.clientId) {
    if (old.admin?.username !== username) {
      throw new Error(`Client ${client.clientId} already uses username "${old.admin?.username}". Preparing again cannot rename an existing account. Use that username, or set a new clientId in branding/client.json for a new client.`);
    }
    console.log(`${client.name} is already prepared with username "${username}".`);
    console.log('Existing credentials, developer key, and client data were not changed.');
    console.log('Next: npm run desktop:dist (installer) or npm run desktop:dev (local desktop test).');
    console.log(`To view saved credentials, run: npm run client:credentials -- show ${client.clientId}`);
    console.log('If the original password was not saved, set new credentials before installation or use the developer-key reset for an installed app.');
    process.exit(0);
  }
}
async function prepare() {
const secrets = await chooseSecrets();
const { key: keyPath } = saveSecrets(client.clientId, username, secrets);
const manifest = {
  version: 1,
  clientId: client.clientId,
  business: {
    name: client.name,
    ownerName: client.ownerName || client.name,
    addressLine1: client.addressLine1 || '',
    addressLine2: client.addressLine2 || '',
    city: client.city || '', state: client.state || '', zipCode: client.zipCode || '',
    phone: client.phone || '', email: client.email || '', taxId: client.taxId || '',
    currency: client.currency || 'USD', timezone: client.timezone || 'America/New_York',
    defaultTaxRateBps: client.defaultTaxRateBps ?? 0,
    receiptFooter: client.receiptFooter || 'Thank you for your business!'
  },
  admin: { username, passwordHash: bcrypt.hashSync(secrets.password, 12) },
  developerKeyHash: crypto.createHash('sha256').update(secrets.key).digest('hex')
};
if (client.sampleData === true) manifest.sampleData = true;
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${client.name} (${client.clientId}).`);
console.log(`Client username: ${username}`);
console.log(`Developer credentials file: ${path.join(root, 'private', `${client.clientId}.json`)}`);
console.log(`Developer key file (never include with installer): ${keyPath}`);
console.log(`To view credentials later: npm run client:credentials -- show ${client.clientId}`);
}
prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
