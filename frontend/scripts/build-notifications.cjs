const fs = require('node:fs');
const path = require('node:path');
const frontend = path.resolve(__dirname, '..');
const source = path.join(frontend, 'notifications');
const output = path.join(__dirname, '..', 'assets', 'generated', 'notifications.json');
const browserOutput = path.join(__dirname, '..', 'public', 'notifications.json');
const client = require('../branding/client.json');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const types = new Set(['announcement', 'feature', 'bugfix', 'maintenance', 'update', 'message']);
const registry = path.join(frontend, 'clients');
const knownClients = new Set([client.clientId]);
if (fs.existsSync(registry)) {
  for (const name of fs.readdirSync(registry).filter(name => name.endsWith('.json'))) {
    const record = JSON.parse(fs.readFileSync(path.join(registry, name), 'utf8'));
    if (!idPattern.test(record.clientId) || name !== `${record.clientId}.json`) throw new Error(`Invalid client registry file: ${name}`);
    knownClients.add(record.clientId);
  }
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing Markdown front matter: ${file}`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const pair = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
    if (!pair) throw new Error(`Invalid notification field in ${file}: ${line}`);
    let value = pair[2];
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error(`Invalid quoted value in ${file}: ${line}`); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    fields[pair[1]] = value;
  }
  for (const key of ['heading', 'description', 'date', 'type', 'targetClient']) {
    if (!fields[key] || typeof fields[key] !== 'string') throw new Error(`Missing ${key} in ${file}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || Number.isNaN(Date.parse(fields.date))) throw new Error(`Invalid date in ${file}`);
  if (!types.has(fields.type)) throw new Error(`Invalid type in ${file}`);
  if (fields.targetClient !== 'all-clients' && !idPattern.test(fields.targetClient)) throw new Error(`Invalid targetClient in ${file}`);
  if (fields.targetClient !== 'all-clients' && !knownClients.has(fields.targetClient)) throw new Error(`Unknown targetClient in ${file}: ${fields.targetClient}`);
  if (!['true', 'false', undefined].includes(fields.updateAvailable)) throw new Error(`Invalid updateAvailable in ${file}`);
  return {
    id: path.basename(file, '.md'),
    heading: fields.heading.slice(0, 160),
    description: fields.description.slice(0, 500),
    date: fields.date,
    type: fields.type,
    targetClient: fields.targetClient,
    updateAvailable: fields.updateAvailable === 'true',
    buttonText: fields.buttonText || 'Update Now',
    content: match[2].trim()
  };
}

if (!idPattern.test(client.clientId)) throw new Error('Invalid clientId in branding/client.json');
const allNotifications = fs.existsSync(source)
  ? fs.readdirSync(source).filter(name => name.endsWith('.md') && name !== 'README.md')
      .map(name => parse(path.join(source, name)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  : [];
function payloadFor(clientId) {
  const notifications = allNotifications.filter(item => item.targetClient === clientId || item.targetClient === 'all-clients');
  return { clientId, notifications };
}
if (process.argv[2] === '--all') {
  for (const clientId of knownClients) {
    const feedPath = path.join(__dirname, '..', 'release-feeds', clientId, 'notifications.json');
    fs.mkdirSync(path.dirname(feedPath), { recursive: true });
    fs.writeFileSync(feedPath, JSON.stringify(payloadFor(clientId), null, 2) + '\n');
    console.log(`Exported notifications for ${clientId}.`);
  }
  process.exit(0);
}
const { notifications } = payloadFor(client.clientId);
if (!client.updateFeedUrl && notifications.some(item => item.updateAvailable)) {
  throw new Error('An update notification targets this client, but branding/client.json has no updateFeedUrl.');
}
fs.mkdirSync(path.dirname(output), { recursive: true });
const payload = JSON.stringify(payloadFor(client.clientId), null, 2) + '\n';
fs.writeFileSync(output, payload);
fs.writeFileSync(browserOutput, payload);
console.log(`Prepared ${notifications.length} notifications for ${client.clientId}.`);
