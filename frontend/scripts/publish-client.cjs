const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { publicLatestYml, publishedAsset } = require('./update-feed.cjs');

const root = path.resolve(__dirname, '..');
const config = require('../updates.json');
const clientId = process.argv[2];
const notificationsOnly = process.argv.includes('--notifications-only');
const checkOnly = process.argv.includes('--check');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
if (!idPattern.test(clientId || '')) throw new Error('Usage: npm run client:publish -- <clientId> [--notifications-only]');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository) || !/^[A-Za-z0-9_.-]+$/.test(config.branch)) throw new Error('Invalid updates.json');
const client = JSON.parse(fs.readFileSync(path.join(root, 'clients', `${clientId}.json`), 'utf8'));
if (client.clientId !== clientId) throw new Error('Client profile mismatch');
const base = `https://raw.githubusercontent.com/${config.repository}/${config.branch}/${clientId}`;
if (client.notificationFeedUrl !== `${base}/notifications.json` || client.updateFeedUrl !== `${base}/windows/`) {
  throw new Error(`Client ${clientId} feed URLs do not match updates.json`);
}

function command(file, args, allowMissing = false) {
  const options = { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4_000_000 };
  let result = spawnSync(file, args, options);
  if (file === 'gh' && result.error?.code === 'ENOENT' && process.platform === 'win32') {
    const installed = 'C:\\Program Files\\GitHub CLI\\gh.exe';
    if (fs.existsSync(installed)) result = spawnSync(installed, args, options);
  }
  if (result.error) throw new Error(file === 'gh' ? 'GitHub CLI is unavailable. Install it with winget install --id GitHub.cli, reopen PowerShell, and run gh auth login.' : `${file} is unavailable: ${result.error.message}`);
  if (result.status !== 0 && !(allowMissing && /HTTP 404|not found/i.test(result.stderr || ''))) {
    throw new Error(`${file} ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.status === 0 ? result.stdout.trim() : null;
}

function gh(...args) { return command('gh', args); }
function apiSha(relativePath) {
  return command('gh', ['api', `repos/${config.repository}/contents/${relativePath}?ref=${config.branch}`, '--jq', '.sha'], true);
}
function upload(relativePath, data, message) {
  const sha = apiSha(relativePath);
  const payload = { message, branch: config.branch, content: Buffer.from(data).toString('base64') };
  if (sha) payload.sha = sha;
  const temporary = path.join(os.tmpdir(), `pos-feed-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(temporary, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
  try { gh('api', '--method', 'PUT', `repos/${config.repository}/contents/${relativePath}`, '--input', temporary); }
  finally { fs.unlinkSync(temporary); }
}

function releaseInfo(tag) {
  const output = command('gh', ['release', 'view', tag, '-R', config.repository, '--json', 'isDraft,assets'], true);
  return output ? JSON.parse(output) : null;
}

function notificationPayload() {
  const source = notificationsOnly
    ? path.join(root, 'release-feeds', clientId, 'notifications.json')
    : path.join(root, 'assets', 'generated', 'notifications.json');
  const bundled = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (bundled.clientId !== clientId || !Array.isArray(bundled.notifications)) throw new Error('Notification bundle is for another client. Run notifications:build after client:select.');
  return JSON.stringify(bundled, null, 2) + '\n';
}

function main() {
  const visibility = gh('repo', 'view', config.repository, '--json', 'visibility', '--jq', '.visibility');
  if (visibility.toUpperCase() !== 'PUBLIC') throw new Error('The downloads repository must be public so installed apps can read it without a token');
  gh('api', `repos/${config.repository}/branches/${config.branch}`, '--jq', '.name');
  if (checkOnly) { console.log(`Public downloads repository ready: ${config.repository}`); return; }
  const active = JSON.parse(fs.readFileSync(path.join(root, 'branding', 'client.json'), 'utf8'));
  if (!notificationsOnly && active.clientId !== clientId) throw new Error(`Select ${clientId} before publishing`);
  const notice = notificationPayload();

  if (!notificationsOnly) {
    const version = require('../package.json').version;
    const directory = path.join(root, 'release', clientId, 'latest-version');
    const installer = `${client.appName || client.name} Setup ${version}.exe`;
    const installerPath = path.join(directory, installer);
    const blockmapPath = `${installerPath}.blockmap`;
    const latestPath = path.join(directory, 'latest.yml');
    const releasePath = path.join(directory, 'release.json');
    for (const file of [installerPath, blockmapPath, latestPath, releasePath]) if (!fs.existsSync(file)) throw new Error(`Build file missing: ${file}`);
    const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
    if (release.clientId !== clientId || release.version !== version) throw new Error('Release metadata does not match selected client and version');
    const tag = `${clientId}-v${version}`;
    const existing = releaseInfo(tag);
    if (existing && !existing.isDraft) {
      publishedAsset(existing.assets, installer, fs.statSync(installerPath).size);
      publishedAsset(existing.assets, `${installer}.blockmap`, fs.statSync(blockmapPath).size);
    } else if (existing) {
      gh('release', 'upload', tag, installerPath, blockmapPath, '-R', config.repository, '--clobber');
      gh('release', 'edit', tag, '-R', config.repository, '--draft=false');
    } else {
      gh('release', 'create', tag, installerPath, blockmapPath, '-R', config.repository,
        '--target', config.branch, '--title', `${client.name} ${version}`,
        '--notes', `Desktop update for ${client.name}.`, '--draft');
      gh('release', 'edit', tag, '-R', config.repository, '--draft=false');
    }

    const published = releaseInfo(tag);
    if (!published || published.isDraft) throw new Error(`Release ${tag} is not published`);
    const installerUrl = publishedAsset(published.assets, installer, fs.statSync(installerPath).size).url;
    const publicLatest = publicLatestYml(fs.readFileSync(latestPath, 'utf8'), version, installerUrl);
    upload(`${clientId}/windows/release.json`, fs.readFileSync(releasePath), `Publish ${clientId} ${version} release metadata`);
    upload(`${clientId}/windows/latest.yml`, publicLatest, `Publish ${clientId} ${version} update`);
  }

  upload(`${clientId}/notifications.json`, notice, `Publish ${clientId} notifications`);
  console.log(`Published ${clientId} ${notificationsOnly ? 'notifications' : 'installer and update feed'} to ${config.repository}.`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
