const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { manifestFor } = require('./client-provisioning.cjs');
require('./write-capacitor-config.cjs');

const root = path.resolve(__dirname, '..');
const client = JSON.parse(fs.readFileSync(path.join(root, 'branding', 'client.json'), 'utf8'));
const manifestPath = manifestFor(client.clientId);
if (!fs.existsSync(manifestPath)) throw new Error('Prepare this client before building mobile: npm run client:prepare -- <admin-username>');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.clientId !== client.clientId || manifest.business?.name !== client.name || !manifest.admin?.passwordHash || !manifest.developerKeyHash) {
  throw new Error('Selected client branding and mobile provisioning do not match.');
}

const temporaryFile = path.join(root, 'public', 'mobile-provisioning.json');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (fs.existsSync(temporaryFile)) throw new Error('Temporary mobile provisioning file already exists. Remove it after checking that no build is running.');
try {
  fs.writeFileSync(temporaryFile, JSON.stringify(manifest));
  const result = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Mobile web build failed (${result.status}).`);
  const bundled = path.join(root, 'out', 'mobile-provisioning.json');
  if (!fs.existsSync(bundled)) throw new Error('Mobile provisioning was not copied to the static output.');
  console.log(`Offline mobile web assets are ready for ${client.name} in frontend/out.`);
} finally {
  fs.rmSync(temporaryFile, { force: true });
}
