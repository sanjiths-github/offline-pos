const crypto = require('node:crypto');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { manifestFor } = require('./client-provisioning.cjs');
const { pathsFor, prompt, chooseSecrets, saveSecrets } = require('./client-secrets.cjs');

async function main() {
  const [action, clientId] = process.argv.slice(2);
  if (!['show', 'set'].includes(action) || !clientId) {
    throw new Error('Usage: npm run client:credentials -- <show|set> <clientId>');
  }
  const files = pathsFor(clientId);
  const manifestPath = manifestFor(clientId);
  if (!fs.existsSync(manifestPath)) throw new Error(`Client ${clientId} is not prepared. Select it and run client:prepare first.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.clientId !== clientId) throw new Error('Provisioning client ID mismatch');

  if (action === 'show') {
    if (!fs.existsSync(files.password)) throw new Error('The original temporary password was not saved. It cannot be recovered from its hash. Use set before installation, or reset-client for an installed app.');
    if (!fs.existsSync(files.key)) throw new Error('Developer key file is missing');
    const saved = JSON.parse(fs.readFileSync(files.password, 'utf8'));
    const key = fs.readFileSync(files.key, 'utf8').trim();
    if (saved.clientId !== clientId || saved.username !== manifest.admin.username || crypto.createHash('sha256').update(key).digest('hex') !== manifest.developerKeyHash || !bcrypt.compareSync(saved.temporaryPassword, manifest.admin.passwordHash)) {
      throw new Error('Saved credentials do not match the prepared installer. Use set before installation.');
    }
    console.log(`Client: ${clientId}`);
    console.log(`Username: ${saved.username}`);
    console.log(`Prepared temporary password: ${saved.temporaryPassword}`);
    console.log(`Developer reset key: ${key}`);
    console.log('The temporary password stops working after the client changes it. Keep this output private.');
    return;
  }

  console.log(`Changing prepared credentials for ${clientId}. This changes future installers only; it does not update an installed app or its data.`);
  if (await prompt('Type the client ID to confirm') !== clientId) throw new Error('Client ID confirmation did not match');
  const secrets = await chooseSecrets();
  manifest.admin.passwordHash = bcrypt.hashSync(secrets.password, 12);
  manifest.developerKeyHash = crypto.createHash('sha256').update(secrets.key).digest('hex');
  saveSecrets(clientId, manifest.admin.username, secrets);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(`Prepared credentials updated for ${clientId}. Build and send a new installer before the first installation.`);
  console.log(`View them later with: npm run client:credentials -- show ${clientId}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
