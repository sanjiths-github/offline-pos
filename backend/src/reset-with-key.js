const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, temporaryPassword, hashPassword, audit } = require('./security');

const [username, keyPath] = process.argv.slice(2);
if (!username || !keyPath) throw new Error('Usage: npm run reset-client -- <username> <developer-key-file>');
const savedHash = db.prepare("SELECT value FROM app_settings WHERE key='developer_key_hash'").get()?.value;
if (!savedHash || !/^[a-f0-9]{64}$/.test(savedHash)) throw new Error('Developer reset is not configured for this client');
const providedHash = crypto.createHash('sha256').update(fs.readFileSync(keyPath,'utf8').trim()).digest();
if (!crypto.timingSafeEqual(providedHash, Buffer.from(savedHash,'hex'))) throw new Error('Invalid developer key');
const user = db.prepare("SELECT id,username,role FROM users WHERE username=? AND role IN ('BUSINESS_ADMIN','CASHIER')").get(username);
if (!user) throw new Error('Client user not found');
const password = temporaryPassword();
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare("UPDATE users SET password_hash=?,must_change_password=1,temporary_password_expires_at=datetime('now','+24 hours'),session_version=session_version+1,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(hashPassword(password),user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  audit(null,'DEVELOPER_PASSWORD_RESET','users',user.id,{username:user.username});
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
console.log(`Temporary password for ${user.username}: ${password}`);
console.log('The client must create a new password at the next login.');
