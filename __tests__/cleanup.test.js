const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { prepareOutputDirectory } = require('../src/core/services/file-manager');
let root;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jpg-clean-')));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture(name) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'preserve unless obsolete');
  return file;
}
function candidates() {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const {cleanupCandidates}=await import(process.argv[1]); console.log(JSON.stringify(await cleanupCandidates(process.argv[2], "1.6.1")));',
      pathToFileURL(path.resolve(__dirname, '../scripts/clean.mjs')).href,
      root
    ],
    { encoding: 'utf8' }
  );
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout).map((p) => path.relative(root, p).split(path.sep).join('/'));
}
it('selects obsolete generated outputs while retaining current packages and user files', () => {
  const kept = [
    'dist/darwin-arm64/image-to-jpg-1.6.1-arm64.dmg',
    'dist/darwin-arm64/Image to JPG.app/Contents/app',
    'dist/darwin-arm64/notes.zip',
    'dist/cli-windows-amd64/bin/node.exe',
    '.mygo/runtime-downloads/node.zip',
    'testimage/original.jpg',
    '__tests__/fixtures/heic-rotation.heic',
    'dist/windows-amd64/image-to-jpg-setup-1.6.1.exe'
  ];
  kept.forEach(fixture);
  fixture('build/old.exe');
  fixture('dist/mac-arm64/old.app');
  fixture('dist/Image to JPG-1.3.0-arm64.dmg');
  fixture('dist/darwin-arm64/image-to-jpg-1.6.0-arm64.dmg');
  fixture('.mygo/concurrency-old/result.json');
  const planned = candidates();
  expect(planned.sort()).toEqual(
    [
      'build',
      'dist/mac-arm64',
      'dist/Image to JPG-1.3.0-arm64.dmg',
      'dist/darwin-arm64/image-to-jpg-1.6.0-arm64.dmg',
      '.mygo/concurrency-old'
    ].sort()
  );
  for (const file of kept)
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe('preserve unless obsolete');
  expect(fs.existsSync(path.join(root, 'build/old.exe'))).toBe(true); // Planning is read-only.
});
it('does not traverse symbolic links to other directories', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jpg-outside-'));
  try {
    fs.mkdirSync(path.join(outside, 'qa-reports'));
    fs.writeFileSync(path.join(outside, 'image-to-jpg-1.0.0-arm64.dmg'), 'keep');
    fs.symlinkSync(
      outside,
      path.join(root, '.gstack'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    fs.symlinkSync(
      outside,
      path.join(root, 'dist'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(candidates()).toEqual([]);
    expect(fs.readFileSync(path.join(outside, 'image-to-jpg-1.0.0-arm64.dmg'), 'utf8')).toBe(
      'keep'
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
it('accepts an already clean workspace', () => {
  expect(candidates()).toEqual([]);
});
it('preparing an existing output directory never clears its contents', () => {
  const existing = fixture('jpg/previous.jpg');
  expect(prepareOutputDirectory(null, root)).toBe(path.join(root, 'jpg'));
  expect(fs.readFileSync(existing, 'utf8')).toBe('preserve unless obsolete');
});
