function publicLatestYml(latest, version, installerUrl) {
  const versionLine = latest.split(/\r?\n/).find(line => line.startsWith('version: '));
  if (versionLine !== `version: ${version}`) throw new Error('latest.yml version does not match the installer');
  let fileUrls = 0;
  let paths = 0;
  const result = latest.replace(/^(\s*(- url|path):\s*).+$/gm, (_line, prefix, type) => {
    if (type === '- url') fileUrls += 1;
    else paths += 1;
    return `${prefix}${JSON.stringify(installerUrl)}`;
  });
  if (fileUrls !== 1 || paths !== 1) throw new Error('Expected one installer URL and path in latest.yml');
  return result;
}

module.exports = { publicLatestYml };
