const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const client = JSON.parse(fs.readFileSync(path.join(root, 'branding', 'client.json'), 'utf8'));
const manifestPath = path.join(root, 'provisioning', 'client.json');
if (!fs.existsSync(manifestPath)) throw new Error('Client is not provisioned. Run npm run client:prepare -- <admin-username> first.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.clientId !== client.clientId || manifest.business?.name !== client.name || !manifest.admin?.passwordHash || !manifest.developerKeyHash) throw new Error('Client branding and provisioning do not match. Review the client files before packaging.');
for (const field of ['notificationFeedUrl', 'updateFeedUrl']) {
  if (!client[field]) continue;
  const url = new URL(client[field]);
  if (url.protocol !== 'https:' || !url.pathname.includes(client.clientId)) throw new Error(`${field} must be HTTPS and contain the stable clientId in its path.`);
}
console.log(`Provisioning ready for ${client.name}.`);
