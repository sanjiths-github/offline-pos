const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const client = JSON.parse(fs.readFileSync(path.join(root, 'branding', 'client.json'), 'utf8'));
if (!/^[a-z0-9-]{3,50}$/.test(client.clientId)) throw new Error('Invalid client ID in branding/client.json.');
const config = {
  appId: `com.connectrader.serveflow.${client.clientId.replaceAll('-', '')}`,
  appName: client.appName || client.name,
  webDir: 'out',
  android: { path: `mobile-native/${client.clientId}/android` },
  ios: { path: `mobile-native/${client.clientId}/ios` }
};
fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`Capacitor configured for ${client.name} (${config.appId}).`);
