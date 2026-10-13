const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clientId = process.argv[2];
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clientId || '')) {
  throw new Error('Usage: node scripts/restore-ci-provisioning.cjs <client-id>');
}
const encoded = (process.env.POS_PROVISIONING_B64 || '').replace(/\s/g, '');
if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
  throw new Error(`Missing or invalid POS_PROVISIONING_B64 secret for ${clientId}`);
}
const bytes = Buffer.from(encoded, 'base64');
if (bytes.toString('base64') !== encoded) throw new Error('Invalid provisioning secret encoding');
const manifest = JSON.parse(bytes.toString('utf8'));
const client = JSON.parse(fs.readFileSync(path.join(root, 'clients', `${clientId}.json`), 'utf8'));
if (manifest.clientId !== clientId || manifest.business?.name !== client.name ||
    !manifest.admin?.passwordHash || !manifest.developerKeyHash) {
  throw new Error('Provisioning secret does not match the selected client');
}
const directory = path.join(root, 'provisioning');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, `${clientId}.json`), bytes, { flag: 'wx', mode: 0o600 });
console.log(`Provisioning restored for ${clientId}.`);
