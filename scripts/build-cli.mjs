import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { prepareRuntime, run } from './prepare-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = `${process.platform === 'win32' ? 'windows' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch}`;

export async function packageCLI(target, prepared = false) {
  if (!/^(darwin|windows|linux)\/(amd64|arm64)$/.test(target))
    throw new Error(`Unsupported CLI target: ${target}`);
  if (!prepared) await prepareRuntime(target);
  const [os] = target.split('/'),
    platform = target.replace('/', '-');
  const resource = path.join(root, 'resources', platform);
  const destination = path.join(root, 'dist', `cli-${platform}`);
  const exe = `batch-image-processor${os === 'windows' ? '.exe' : ''}`;
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  for (const dir of ['bin', 'engine'])
    await fs.cp(path.join(resource, dir), path.join(destination, dir), { recursive: true });
  await fs.copyFile(path.join(resource, exe), path.join(destination, exe));
  if (os !== 'windows') await fs.chmod(path.join(destination, exe), 0o755);
  if (os === 'darwin' && process.platform === 'darwin')
    await run('codesign', ['--force', '--sign', '-', path.join(destination, exe)]);
  await fs.copyFile(path.join(root, 'docs', 'cli.md'), path.join(destination, 'README-CLI.md'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const archive = path.join(destination, `batch-image-processor-${pkg.version}-${platform}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(destination);
  zip.writeZip(archive);
  console.log(`Standalone CLI: ${archive}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const target of (process.argv[2] || host).split(',')) await packageCLI(target);
}
