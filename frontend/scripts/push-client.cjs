const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const root = path.resolve(__dirname, '..', '..');
const frontend = path.resolve(__dirname, '..');
const currentClient = require('../branding/client.json');
let version = require('../package.json').version;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || `git ${args[0]} failed`).trim());
  return result.stdout.trim();
}

function run(file, args, cwd = frontend) {
  const result = spawnSync(file, args, { cwd, windowsHide: true, stdio: 'inherit', shell: file === 'npm.cmd' });
  if (result.error || result.status !== 0) throw new Error(`${file} ${args[0]} failed. Fix the error above and retry.`);
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
      ['normal', 'Normal code change', 'Normal code change (no installer)'],
      ['notification', 'Notification', 'Notification (no installer)'],
      ['update', 'Software update', 'Software update (installer and update button)'],
      ['bugfix', 'Bug fix', 'Bug fix announcement (no installer)'],
      ['feature', 'New feature', 'New feature announcement (no installer)']
    ];
    console.log('What type of change is this?\n');
    types.forEach(([_, , menuLabel], number) => console.log(`${number + 1}. ${menuLabel}`));
    const typeIndex = Number((await rl.question('\nSelect type: ')).trim()) - 1;
    if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= types.length) throw new Error('Invalid change type');
    const [type, label] = types[typeIndex];
    if (type === 'update' && clientId === 'all-clients') throw new Error('Choose one client for an application update. Each client needs its own installer.');
    if (type === 'normal' && git('status', '--porcelain') === '') throw new Error('There are no code changes to push.');
    if (type !== 'normal') {
      const targets = clientId === 'all-clients' ? choices.map(item => item.clientId) : [clientId];
      for (const target of targets) run(process.execPath, [path.join(frontend, 'scripts', 'publish-client.cjs'), target, '--check']);
    }
    if (type === 'update') {
      const releaseDir = path.join(frontend, 'update-metadata');
      const previous = fs.existsSync(releaseDir)
        ? fs.readdirSync(releaseDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(releaseDir, name), 'utf8')))
            .filter(item => item.type === 'update' && (clientId === 'all-clients' || item.clientId === clientId || item.clientId === 'all-clients'))
        : [];
      const parts = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
      const currentParts = parts(version);
      if (!currentParts) throw new Error('Use a numeric package version such as 1.2.3');
      currentParts[2] += 1;
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
    console.log(`\nClient: ${clientId}\nType: ${label}\nMessage: ${message}\nNotification: ${needsNotice ? 'Yes' : 'No'}\nInstaller build: ${type === 'update' ? 'Yes' : 'No'}`);
    if ((await rl.question(type === 'update' ? '\nBuild this client, push code, and publish its update? (Y/N): ' : '\nStage project changes, commit, and push? (Y/N): ')).trim().toLowerCase() !== 'y') {
      console.log('Cancelled. Nothing was pushed.');
      return;
    }
    if (type === 'update') {
      run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', 'patch', '--no-git-tag-version']);
      version = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8')).version;
      run(process.execPath, [path.join(frontend, 'scripts', 'select-client.cjs'), clientId]);
      run(process.execPath, [path.join(frontend, 'scripts', 'check-client.cjs')]);
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
        ...(type === 'update' ? [`version: ${JSON.stringify(version)}`] : []),
        `buttonText: ${JSON.stringify(buttonText || 'Update Now')}`, '---', '', message, ''
      ];
      fs.writeFileSync(noticePath, fields.join('\n'), { flag: 'wx' });
    }
    if (type === 'update') run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'desktop:dist']);
    else if (needsNotice) run(process.execPath, [path.join(frontend, 'scripts', 'build-notifications.cjs'), '--all']);
    git('add', '-A', '--', '.');
    const staged = git('diff', '--cached', '--name-only').split(/\r?\n/);
    const sensitive = staged.filter(name => /(?:^|\/)(?:node_modules|data|provisioning|private)(?:\/|$)|\.key$|\.sqlite(?:-wal|-shm)?$|(?:^|\/)release[^/]*\//i.test(name.replaceAll('\\', '/')));
    if (sensitive.length) throw new Error(`Refusing to push sensitive or generated files: ${sensitive.join(', ')}`);
    git('commit', '-m', `[${clientId}] ${label}: ${message}`);
    const branch = git('branch', '--show-current');
    if (!branch) throw new Error('Cannot determine the current Git branch.');
    let hasUpstream = true;
    try { git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'); }
    catch { hasUpstream = false; }
    console.log(hasUpstream ? git('push') : git('push', '-u', 'origin', branch));
    console.log(needsNotice ? 'Private source pushed. Publishing selected client feed...' : 'Private source pushed.');
    try {
      if (type === 'update') run(process.execPath, [path.join(frontend, 'scripts', 'publish-client.cjs'), clientId]);
      else if (needsNotice) {
        const targets = clientId === 'all-clients' ? choices.map(item => item.clientId) : [clientId];
        for (const target of targets) run(process.execPath, [path.join(frontend, 'scripts', 'publish-client.cjs'), target, '--notifications-only']);
      }
    } catch (error) {
      console.error(clientId === 'all-clients'
        ? 'Source push succeeded, but feed publishing failed. Retry client:publish -- <clientId> --notifications-only for each client.'
        : `Source push succeeded, but feed publishing failed. Fix the issue and retry: npm run client:publish -- ${clientId}${type === 'update' ? '' : ' --notifications-only'}`);
      throw error;
    }
    console.log(`Pushed successfully${needsNotice ? ' and published the selected client feed' : ''}.`);
  } finally { rl.close(); }
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
