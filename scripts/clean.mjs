import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function entries(directory) {
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return [];
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Only versioned release packages; keep app executables and bundled runtimes.
export async function obsoletePackages(directory, version) {
  return (await entries(directory))
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(image-to-jpg|batch-image-processor)-\d+\.\d+\.\d+-.+\.(dmg|zip|deb|tar\.gz|exe)$/.test(
          entry.name
        )
    )
    .filter(
      (entry) =>
        !['image-to-jpg', 'batch-image-processor'].some((prefix) =>
          entry.name.startsWith(`${prefix}-${version}-`)
        )
    )
    .map((entry) => path.join(directory, entry.name));
}

export async function cleanupCandidates(projectRoot, version) {
  const root = await fs.realpath(projectRoot);
  const candidates = ['build', 'coverage', '.gstack/qa-reports'];
  const legacyDirs = new Set(['mac', 'mac-arm64', 'win-unpacked', 'win-arm64-unpacked']);
  const legacyMetadata = new Set([
    'builder-debug.yml',
    'builder-effective-config.yaml',
    'latest-mac.yml',
    'latest.yml',
    '.DS_Store'
  ]);
  for (const entry of await entries(path.join(root, 'dist'))) {
    if (
      legacyDirs.has(entry.name) ||
      legacyMetadata.has(entry.name) ||
      /^Image to JPG[ -]\d+\.\d+\.\d+(?:$|[ .-])/.test(entry.name)
    )
      candidates.push(`dist/${entry.name}`);
    else if (/^(?:cli-)?(?:darwin|windows|linux)-(?:arm64|amd64)$/.test(entry.name))
      candidates.push(
        ...(await obsoletePackages(path.join(root, 'dist', entry.name), version)).map((file) =>
          path.relative(root, file)
        )
      );
  }
  for (const entry of await entries(path.join(root, '.mygo'))) {
    if (
      /^(?:concurrency-|ui-twenty-)/.test(entry.name) ||
      [
        'heic-investigation',
        'check-footer.cjs',
        'compression-ui-fixture.txt',
        'compression-ui-result.json',
        'image-to-jpg-linux'
      ].includes(entry.name)
    )
      candidates.push(`.mygo/${entry.name}`);
  }
  const found = [];
  for (const relative of candidates) {
    let current = root,
      safe = true;
    for (const part of path.normalize(relative).split(path.sep)) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) {
          safe = false;
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        safe = false;
        break;
      }
    }
    if (safe) found.push(current);
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--dry-run'))
    throw new Error('Usage: npm run clean -- [--dry-run]');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const files = await cleanupCandidates(root, version);
  for (const file of files) {
    console.log(
      `${flags.includes('--dry-run') ? 'Would remove' : 'Removing'}: ${path.relative(root, file)}`
    );
    if (!flags.includes('--dry-run')) await fs.rm(file, { recursive: true, force: true });
  }
  console.log(
    `${files.length} generated paths; current ${version} packages, runtime downloads and source fixtures retained.`
  );
}
