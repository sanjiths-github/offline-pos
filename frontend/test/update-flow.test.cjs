const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateFlow } = require('../electron/update-flow.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('one click during a background check downloads, installs, and restarts', async () => {
  const pending = deferred();
  const current = { status: 'checking' };
  let downloads = 0;
  let installs = 0;
  const flow = createUpdateFlow({
    readRelease: async () => ({ version: '1.2.0' }),
    check: () => pending.promise,
    download: async () => { downloads += 1; current.status = 'downloaded'; },
    state: () => current,
    error: cause => { throw cause; },
    install: () => { installs += 1; current.status = 'installing'; }
  });
  const background = flow.run();
  const clicked = flow.run(true);
  pending.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } });
  await Promise.all([background, clicked]);
  assert.equal(downloads, 1);
  assert.equal(installs, 1);
  assert.equal(current.status, 'installing');
});

test('a downloaded update installs on the first click without another check', async () => {
  const current = { status: 'downloaded' };
  let installs = 0;
  const flow = createUpdateFlow({
    readRelease: async () => { throw new Error('Should not read release'); },
    check: async () => { throw new Error('Should not check again'); },
    download: async () => { throw new Error('Should not download again'); },
    state: () => current,
    error: cause => { throw cause; },
    install: () => { installs += 1; current.status = 'installing'; }
  });
  await flow.run(true);
  assert.equal(installs, 1);
});

test('release mismatch does not download or install', async () => {
  const current = { status: 'checking' };
  let errors = 0;
  const flow = createUpdateFlow({
    readRelease: async () => ({ version: '1.2.0' }),
    check: async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.2.1' } }),
    download: async () => { throw new Error('Should not download'); },
    state: () => current,
    error: () => { errors += 1; current.status = 'error'; },
    install: () => { throw new Error('Should not install'); }
  });
  await flow.run(true);
  assert.equal(errors, 1);
  assert.equal(current.status, 'error');
});
