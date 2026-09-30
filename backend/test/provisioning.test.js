const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

test('client provisioning and developer reset preserve local data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-provision-'));
  const manifestPath = path.join(dir, 'client.json');
  const keyPath = path.join(dir, 'developer.key');
  const key = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(keyPath, key);
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1, clientId: 'test-client', business: { name: 'Test Cafe', ownerName: 'Test Owner' },
    admin: { username: 'testadmin', passwordHash: bcrypt.hashSync('InitialPass123!', 12) },
    developerKeyHash: crypto.createHash('sha256').update(key).digest('hex'), sampleData: true
  }));
  const env = { ...process.env, POS_DATA_DIR: dir };
  const run = (file, ...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'src', file), ...args], { env, encoding: 'utf8' });
  try {
    run('apply-provisioning.js', manifestPath);
    const db = new DatabaseSync(path.join(dir, 'pos.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 7);
    assert.equal(db.prepare('SELECT must_change_password AS flag FROM users WHERE username=?').get('testadmin').flag, 1);
    db.prepare("INSERT INTO customers(name,phone) VALUES('Keep Me','1234567890')").run();
    db.close();
    run('apply-provisioning.js', manifestPath);
    const resetOutput = run('reset-with-key.js', 'testadmin', keyPath);
    assert.match(resetOutput, /Temporary password for testadmin:/);
    const after = new DatabaseSync(path.join(dir, 'pos.sqlite'));
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 1);
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM products').get().count, 7);
    const user = after.prepare('SELECT * FROM users WHERE username=?').get('testadmin');
    assert.equal(user.must_change_password, 1);
    assert.equal(user.session_version, 1);
    assert.equal(bcrypt.compareSync('InitialPass123!', user.password_hash), false);
    after.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
