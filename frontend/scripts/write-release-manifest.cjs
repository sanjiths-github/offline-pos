const fs = require('node:fs');
const path = require('node:path');
const client = require('../branding/client.json');
const { version } = require('../package.json');
const output = path.join(__dirname, '..', 'release', 'release.json');
const data = {
  clientId: client.clientId,
  version,
  appId: `com.localpos.${client.clientId.replaceAll('-', '')}`
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(`Wrote release metadata for ${client.clientId} ${version}.`);
