const { db, temporaryPassword, hashPassword } = require('./security');
const username = process.argv[2] || 'systemadmin';
if (db.prepare("SELECT id FROM users WHERE role='SYSTEM_ADMIN'").get()) { console.error('System administrator already exists'); process.exit(1); }
if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) { console.error('Username must be 3-40 letters, numbers, dots, underscores or dashes'); process.exit(1); }
const password = temporaryPassword();
db.prepare("INSERT INTO users(username,password_hash,role,must_change_password,temporary_password_expires_at) VALUES(?,?,'SYSTEM_ADMIN',1,datetime('now','+24 hours'))").run(username,hashPassword(password));
console.log(`System administrator: ${username}\nTemporary password (shown once): ${password}`);
