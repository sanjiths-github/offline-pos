const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function pathsFor(clientId) {
  if (!/^[a-z0-9-]{3,50}$/.test(clientId)) throw new Error('Invalid client ID');
  return {
    password: path.join(root, 'private', `${clientId}.json`),
    key: path.join(root, 'branding', `developer-${clientId}.key`)
  };
}

function prompt(label, hidden = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal. Do not pass passwords as command arguments.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(`${label}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      const input = chunk.toString('utf8');
      for (const character of input) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          if (!hidden) process.stdout.write('\b \b');
        } else if (character >= ' ' && character !== '\u007f') {
          value += character;
          if (!hidden) process.stdout.write(character);
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function chooseSecrets() {
  const password = await prompt('Temporary client password (hidden)', true);
  if (password.length < 10 || password.length > 128) throw new Error('Temporary password must be 10-128 characters');
  if (await prompt('Confirm temporary password (hidden)', true) !== password) throw new Error('Temporary passwords do not match');
  const key = await prompt('Developer reset key, at least 24 characters (hidden)', true);
  if (key.length < 24 || key.length > 256) throw new Error('Developer reset key must be 24-256 characters');
  if (key === password) throw new Error('Use a different developer reset key');
  if (await prompt('Confirm developer reset key (hidden)', true) !== key) throw new Error('Developer reset keys do not match');
  return { password, key };
}

function saveSecrets(clientId, username, secrets) {
  const files = pathsFor(clientId);
  fs.mkdirSync(path.dirname(files.password), { recursive: true });
  fs.writeFileSync(files.password, JSON.stringify({ clientId, username, temporaryPassword: secrets.password }, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(files.key, secrets.key + '\n', { mode: 0o600 });
  return files;
}

module.exports = { pathsFor, prompt, chooseSecrets, saveSecrets };
