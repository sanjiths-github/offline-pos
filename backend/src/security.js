const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const temporaryPassword = () => `Temp@${crypto.randomInt(100000,1000000)}`;
const hashPassword = password => bcrypt.hashSync(password, 12);
function audit(userId, action, entityType, entityId, details = {}) {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?)').run(userId,action,entityType,entityId,JSON.stringify(details));
}
function issueSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at) VALUES(?,?,?,datetime('now','+12 hours'))").run(hashToken(token),user.id,user.session_version);
  return token;
}
function authenticate(req,res,next) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const user = db.prepare("SELECT u.id,u.username,u.role,u.employee_id,u.must_change_password,u.is_active,u.session_version,s.expires_at,b.status AS business_status FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN businesses b ON b.id=1 WHERE s.token_hash=?").get(hashToken(token));
  if (!user || !user.is_active || user.session_version !== db.prepare('SELECT session_version FROM sessions WHERE token_hash=?').get(hashToken(token))?.session_version || user.expires_at <= new Date().toISOString().replace('T',' ').slice(0,19)) return res.status(401).json({ error: 'Session expired' });
  if (user.role !== 'SYSTEM_ADMIN' && user.business_status !== 'ACTIVE') return res.status(403).json({ error: 'Business inactive' });
  req.user = user; req.tokenHash = hashToken(token); next();
}
function access(...roles) { return (req,res,next) => {
  if (req.user.must_change_password) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}; }
module.exports = { db, bcrypt, hashToken, temporaryPassword, hashPassword, audit, issueSession, authenticate, access };
