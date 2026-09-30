const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'provisioning');

function manifestFor(clientId, migrateLegacy = false) {
  const target = path.join(directory, `${clientId}.json`);
  if (fs.existsSync(target)) return target;
  const legacy = path.join(directory, 'client.json');
  if (fs.existsSync(legacy)) {
    const previous = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    if (previous.clientId === clientId) {
      if (migrateLegacy) {
        fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL);
        return target;
      }
      return legacy;
    }
  }
  return target;
}

module.exports = { manifestFor };
