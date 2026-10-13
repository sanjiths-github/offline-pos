const expected = process.argv[2];
if (process.platform !== expected) {
  throw new Error(`This installer must be built on ${expected === 'darwin' ? 'macOS' : expected === 'linux' ? 'Linux' : 'Windows'}. Current platform: ${process.platform}`);
}
