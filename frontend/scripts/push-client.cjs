const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const root = path.resolve(__dirname, '..', '..');
const frontend = path.resolve(__dirname, '..');
const currentClient = require('../branding/client.json');
const version = require('../package.json').version;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || `git ${args[0]} failed`).trim());
  return result.stdout.trim();
}

function clients() {
  const directory = path.join(frontend, 'clients');
  const records = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
    : [];
  records.push({ clientId: currentClient.clientId, name: currentClient.name });
  const unique = new Map(records.map(record => [record.clientId, record]));
  for (const record of unique.values()) if (!idPattern.test(record.clientId)) throw new Error(`Invalid client ID: ${record.clientId}`);
  return [...unique.values()].sort((a, b) => a.clientId.localeCompare(b.clientId));
}

async function main() {
  try { git('rev-parse', '--show-toplevel'); } catch { throw new Error('This project is not a Git repository yet. Initialize Git and add a remote before using push-client.'); }
  if (!git('remote').split(/\r?\n/).includes('origin')) throw new Error('No origin remote is configured. Add your private GitHub repository first.');
  if (git('status', '--porcelain') === '') throw new Error('There are no changes to push.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const choices = clients();
    console.log('Which client is this change for?\n');
    choices.forEach((record, index) => console.log(`${index + 1}. ${record.clientId}`));
    console.log(`${choices.length + 1}. all-clients`);
    const index = Number((await rl.question('\nSelect client: ')).trim()) - 1;
    if (!Number.isInteger(index) || index < 0 || index > choices.length) throw new Error('Invalid client selection');
    const clientId = choices[index]?.clientId || 'all-clients';
    console.log(`Selected client: ${clientId}\n`);
    const types = [
      ['normal', 'Normal code change'],
      ['notification', 'Notification'],
      ['update', 'Software update'],
      ['bugfix', 'Bug fix'],
      ['feature', 'New feature']
    ];
    console.log('What type of change is this?\n');
    types.forEach(([_, label], number) => console.log(`${number + 1}. ${label}`));
    const typeIndex = Number((await rl.question('\nSelect type: ')).trim()) - 1;
    if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= types.length) throw new Error('Invalid change type');
    const [type, label] = types[typeIndex];
    if (type === 'update') {
      const releaseDir = path.join(frontend, 'update-metadata');
      const previous = fs.existsSync(releaseDir)
        ? fs.readdirSync(releaseDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(releaseDir, name), 'utf8')))
            .filter(item => item.type === 'update' && (clientId === 'all-clients' || item.clientId === clientId || item.clientId === 'all-clients'))
        : [];
      const parts = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
      const currentParts = parts(version);
      if (!currentParts) throw new Error('Use a numeric package version such as 1.2.3');
      for (const item of previous) {
        const older = parts(item.version);
        const firstDifference = older?.findIndex((number, index) => number !== currentParts[index]) ?? -1;
        if (older && (firstDifference === -1 || currentParts[firstDifference] < older[firstDifference])) {
          throw new Error(`Increase frontend/package.json version above ${item.version} before a software update.`);
        }
      }
    }
    const message = (await rl.question('Enter update message: ')).trim();
    if (!message || message.length > 160 || /[\r\n]/.test(message)) throw new Error('Enter a message of 1–160 characters');
    const needsNotice = type !== 'normal';
    const buttonText = type === 'update' ? (await rl.question('Update button text [Update Now]: ')).trim() || 'Update Now' : '';
    console.log(`\nClient: ${clientId}\nType: ${label}\nMessage: ${message}\nNotification: ${needsNotice ? 'Yes' : 'No'}`);
    if ((await rl.question('\nStage project changes, commit, and push? (Y/N): ')).trim().toLowerCase() !== 'y') {
      console.log('Cancelled. Nothing was pushed.');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const metadataDir = path.join(frontend, 'update-metadata');
    fs.mkdirSync(metadataDir, { recursive: true });
    const metadataPath = path.join(metadataDir, `${stamp}-${clientId}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify({ clientId, version, type, message, date: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    if (needsNotice) {
      const noticePath = path.join(frontend, 'notifications', `${stamp}-${clientId}.md`);
      const heading = type === 'update' ? 'POS update available' : label;
      const fields = [
        '---', `heading: ${JSON.stringify(heading)}`, `description: ${JSON.stringify(message)}`,
        `date: ${JSON.stringify(new Date().toISOString().slice(0, 10))}`, `type: ${JSON.stringify(type === 'notification' ? 'announcement' : type)}`,
        `targetClient: ${JSON.stringify(clientId)}`, `updateAvailable: ${type === 'update'}`,
        `buttonText: ${JSON.stringify(buttonText || 'Update Now')}`, '---', '', message, ''
      ];
      fs.writeFileSync(noticePath, fields.join('\n'), { flag: 'wx' });
    }
    git('add', '-A', '--', '.');
    const staged = git('diff', '--cached', '--name-only').split(/\r?\n/);
    const sensitive = staged.filter(name => /(?:^|\/)(?:node_modules|data|provisioning)(?:\/|$)|\.key$|\.sqlite(?:-wal|-shm)?$|(?:^|\/)release[^/]*\//i.test(name.replaceAll('\\', '/')));
    if (sensitive.length) throw new Error(`Refusing to push sensitive or generated files: ${sensitive.join(', ')}`);
    git('commit', '-m', `[${clientId}] ${label}: ${message}`);
    const branch = git('branch', '--show-current');
    if (!branch) throw new Error('Cannot determine the current Git branch.');
    let hasUpstream = true;
    try { git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'); }
    catch { hasUpstream = false; }
    console.log(hasUpstream ? git('push') : git('push', '-u', 'origin', branch));
    console.log('Pushed successfully. A GitHub build/publishing workflow is still required to deliver this change to installed apps.');
  } finally { rl.close(); }
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
