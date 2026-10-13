const { spawn } = require('node:child_process');

function command(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
    let output = '';
    let error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error.trim() || `${file} exited with code ${code}`)));
    child.stdin.end(input);
  });
}

function parseCupsPrinters(namesText, statusText, devicesText) {
  const statuses = new Map();
  const devices = new Map();
  for (const line of statusText.split(/\r?\n/)) {
    const match = /^printer (\S+) (.*)$/.exec(line);
    if (match) statuses.set(match[1], match[2].trim());
  }
  for (const line of devicesText.split(/\r?\n/)) {
    const match = /^device for (\S+):\s*(.*)$/.exec(line);
    if (match) devices.set(match[1], match[2].trim());
  }
  return namesText.split(/\r?\n/).map(name => name.trim()).filter(Boolean).map(name => {
    const status = statuses.get(name) || 'Status unavailable';
    const device = devices.get(name) || '';
    return {
      name,
      portName: device,
      driverName: 'CUPS printer queue',
      status,
      connectionType: /^bluetooth:/i.test(device) ? 'BLUETOOTH' : /^usb:/i.test(device) ? 'USB' : 'SYSTEM',
      connected: !/disabled|offline|error|stopped/i.test(status)
    };
  });
}

async function listCupsPrinters() {
  let names;
  try { names = await command('lpstat', ['-e']); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('CUPS printer tools are unavailable. Install or enable CUPS on this computer.');
    throw error;
  }
  if (!names.trim()) return [];
  const [statuses, devices] = await Promise.all([
    command('lpstat', ['-p']),
    command('lpstat', ['-v'])
  ]);
  return parseCupsPrinters(names, statuses, devices);
}

async function printCups(name, content) {
  await command('lp', ['-d', name], content);
}

module.exports = { parseCupsPrinters, listCupsPrinters, printCups };
