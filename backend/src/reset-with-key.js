const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, hashPassword, audit } = require('./security');

const [username, keyPath] = process.argv.slice(2);
if (!username || !keyPath) throw new Error('Usage: npm run reset-client -- <username> <developer-key-file>');
const savedHash = db.prepare("SELECT value FROM app_settings WHERE key='developer_key_hash'").get()?.value;
if (!savedHash || !/^[a-f0-9]{64}$/.test(savedHash)) throw new Error('Developer reset is not configured for this client');
const providedHash = crypto.createHash('sha256').update(fs.readFileSync(keyPath,'utf8').trim()).digest();
if (!crypto.timingSafeEqual(providedHash, Buffer.from(savedHash,'hex'))) throw new Error('Invalid developer key');
const user = db.prepare("SELECT id,username,role FROM users WHERE username=? AND role IN ('BUSINESS_ADMIN','CASHIER')").get(username);
if (!user) throw new Error('Client user not found');
async function promptPassword() {
  if (process.argv.includes('--password-stdin')) {
    const [password, confirmation] = fs.readFileSync(0, 'utf8').split(/\r?\n/);
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new Error('Temporary password must be 10-128 characters');
    if (password !== confirmation) throw new Error('Temporary passwords do not match');
    return password;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run reset-client in an interactive terminal');
  const ask = label => new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(`${label}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = error => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && character !== '\u007f') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
  const password = await ask('New temporary client password (hidden)');
  if (password.length < 10 || password.length > 128) throw new Error('Temporary password must be 10-128 characters');
  if (await ask('Confirm temporary password (hidden)') !== password) throw new Error('Temporary passwords do not match');
  return password;
}

async function reset() {
  try {
    const password = await promptPassword();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE users SET password_hash=?,must_change_password=1,temporary_password_expires_at=datetime('now','+24 hours'),session_version=session_version+1,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(hashPassword(password),user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(null,'DEVELOPER_PASSWORD_RESET','users',user.id,{username:user.username});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(`Temporary password set for ${user.username}. Give the chosen password to the client privately.`);
    console.log('The client must create a new password at the next login.');
  } finally {
    db.close();
  }
}
reset().catch(error => { console.error(error.message); process.exitCode = 1; });
