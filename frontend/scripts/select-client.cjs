const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const clientId = process.argv[2];
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clientId || '')) {
  throw new Error('Usage: npm run client:select -- <client-id>');
}
const profilePath = path.join(root, 'clients', `${clientId}.json`);
if (!fs.existsSync(profilePath)) throw new Error(`Client profile not found: ${profilePath}`);
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
if (profile.clientId !== clientId || !profile.name || !profile.logo) throw new Error('Client profile must have matching clientId, name, and logo');
const logoPath = path.resolve(root, 'branding', profile.logo);
const brandingDir = path.join(root, 'branding');
if (!logoPath.startsWith(brandingDir + path.sep) || !fs.existsSync(logoPath)) {
  throw new Error(`Logo must exist inside frontend/branding: ${profile.logo}`);
}
fs.writeFileSync(path.join(brandingDir, 'client.json'), JSON.stringify(profile, null, 2) + '\n');
console.log(`Selected ${profile.name} (${clientId}).`);
console.log('Next: npm run client:prepare -- <admin-username>, then npm run desktop:dist.');
