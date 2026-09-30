const test = require('node:test');
const assert = require('node:assert/strict');
const { publicLatestYml, publishedAsset } = require('../scripts/update-feed.cjs');

test('rewrite only one client installer URL while keeping checksums', () => {
  const original = 'version: 1.1.4\nfiles:\n  - url: Downtown Coffee POS Setup 1.1.4.exe\n    sha512: checked-value\npath: Downtown Coffee POS Setup 1.1.4.exe\nsha512: checked-value\n';
  const url = 'https://github.com/example/downloads/releases/download/downtown-coffee-house-v1.1.4/Downtown%20Coffee%20POS%20Setup%201.1.4.exe';
  const changed = publicLatestYml(original, '1.1.4', url);
  assert.equal(changed.match(new RegExp(url, 'g')).length, 2);
  assert.equal(changed.match(/sha512: checked-value/g).length, 2);
  assert.throws(() => publicLatestYml(original, '1.1.5', url), /version/);
});

test('use the actual GitHub asset URL after GitHub renames spaces', () => {
  const url = 'https://github.com/example/downloads/releases/download/client-v1.1.4/Downtown.Coffee.POS.Setup.1.1.4.exe';
  const assets = [{ name: 'Downtown.Coffee.POS.Setup.1.1.4.exe', size: 123, url }];
  assert.equal(publishedAsset(assets, 'Downtown Coffee POS Setup 1.1.4.exe', 123).url, url);
  assert.throws(() => publishedAsset(assets, 'Downtown Coffee POS Setup 1.1.4.exe', 456), /Expected one/);
});
