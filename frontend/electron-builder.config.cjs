const fs = require('node:fs');
const path = require('node:path');
const client = JSON.parse(fs.readFileSync(path.join(__dirname, 'branding', 'client.json'), 'utf8'));
if (!/^[a-z0-9-]{3,50}$/.test(client.clientId)) throw new Error('clientId must be 3-50 lowercase letters, numbers, or hyphens');
module.exports = {
  appId: `com.localpos.${client.clientId.replaceAll('-', '')}`,
  productName: client.appName || client.name,
  electronDist: 'node_modules/electron/dist',
  directories: { output: 'release' },
  ...(client.updateFeedUrl ? { publish: [{ provider: 'generic', url: client.updateFeedUrl }] } : {}),
  files: ['out/**/*', 'electron/**/*', 'assets/generated/**/*', 'branding/client.json', 'package.json'],
  extraResources: [
    { from: '../backend', to: 'backend', filter: ['src/**/*', 'package.json', 'package-lock.json'] },
    { from: '../backend/node_modules', to: 'backend/node_modules', filter: ['**/*'] },
    { from: 'provisioning/client.json', to: 'provisioning/client.json' }
  ],
  win: { target: 'nsis', icon: 'assets/generated/icon.ico' },
  mac: { target: 'dmg', icon: 'assets/generated/icon.png' },
  linux: { target: 'AppImage', icon: 'assets/generated/icon.png' }
};
