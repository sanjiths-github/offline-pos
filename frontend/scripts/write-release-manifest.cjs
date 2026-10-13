const fs = require('node:fs');
const path = require('node:path');
const client = require('../branding/client.json');
const { version } = require('../package.json');
if (!/^[a-z0-9-]{3,50}$/.test(client.clientId)) throw new Error('Invalid client ID');
const platformFolder = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null;
const directory = path.join(__dirname, '..', 'release', client.clientId, ...(platformFolder ? [platformFolder] : []), 'latest-version');
const output = path.join(directory, 'release.json');
if (process.platform === 'win32') {
  const expected = `${client.appName || client.name} Setup ${version}.exe`;
  if (!fs.existsSync(path.join(directory, expected))) throw new Error(`Current installer not found: ${expected}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.nsis.7z')) {
      fs.unlinkSync(path.join(directory, entry.name));
      continue;
    }
    if (!/ Setup .+\.exe(?:\.blockmap)?$/i.test(entry.name)) continue;
    if (entry.name === expected || entry.name === `${expected}.blockmap`) continue;
    fs.unlinkSync(path.join(directory, entry.name));
  }
}
if (process.platform === 'darwin' || process.platform === 'linux') {
  const required = process.platform === 'darwin' ? ['.dmg', '.zip'] : ['.AppImage'];
  const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  for (const extension of required) {
    if (!files.some(name => name.includes(version) && name.endsWith(extension))) {
      throw new Error(`Current ${extension} build not found in ${directory}`);
    }
  }
}
const data = {
  clientId: client.clientId,
  version,
  platform: process.platform,
  appId: `com.localpos.${client.clientId.replaceAll('-', '')}`
};
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(`Latest release for ${client.clientId} ${version}: ${directory}`);
