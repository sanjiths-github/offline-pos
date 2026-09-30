function createUpdateFlow({ readRelease, check, download, state, error, install }) {
  let task = null;
  let installRequested = false;

  async function run(requestInstall = false) {
    if (requestInstall) installRequested = true;
    if (task) return task;
    task = (async () => {
      try {
        if (state().status === 'installing') return state();
        if (state().status === 'downloaded') {
          if (installRequested) { installRequested = false; install(); }
          return state();
        }
        const release = await readRelease();
        const result = await check();
        if (result?.isUpdateAvailable && result.updateInfo?.version !== release.version) {
          throw new Error('Update version does not match the client release metadata');
        }
        if (result?.isUpdateAvailable && installRequested) {
          await download();
          installRequested = false;
          install();
        } else if (!result?.isUpdateAvailable) {
          installRequested = false;
        }
        return state();
      } catch (cause) {
        installRequested = false;
        error(cause);
        return state();
      } finally {
        task = null;
      }
    })();
    return task;
  }

  return { run };
}

module.exports = { createUpdateFlow };
