const fs = require('node:fs');
const path = require('node:path');
const client = require('../branding/client.json');
const { version } = require('../package.json');
if (!/^[a-z0-9-]{3,50}$/.test(client.clientId)) throw new Error('Invalid client ID');
const directory = path.join(__dirname, '..', 'release', client.clientId, 'latest-version');
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
const data = {
  clientId: client.clientId,
  version,
  appId: `com.localpos.${client.clientId.replaceAll('-', '')}`
};
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(`Latest release for ${client.clientId} ${version}: ${directory}`);
