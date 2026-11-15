import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
const nodeVersion = '24.18.0';
const hostPlatform = `${process.platform === 'win32' ? 'windows' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch}`;

async function refreshSources(destination, platform) {
  for (const name of ['core', 'desktop', 'cli']) {
    const target = path.join(destination, 'engine', 'src', name);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(path.join(root, 'src', name), target, { recursive: true });
  }
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const enginePath = path.join(destination, 'engine', 'package.json');
  const engine = JSON.parse(await fs.readFile(enginePath, 'utf8'));
  engine.version = pkg.version;
  await fs.writeFile(enginePath, JSON.stringify(engine, null, 2) + '\n');
  const [os, arch] = platform.split('/');
  await run(
    'go',
    [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.version=${pkg.version}`,
      '-o',
      path.join(destination, `batch-image-processor${os === 'windows' ? '.exe' : ''}`),
      './cmd/batch-image-processor'
    ],
    {
      env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' }
    }
  );
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal || code}`))
    );
  });
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function prepareRuntime(platform = hostPlatform) {
  if (!/^(darwin|windows|linux)\/(arm64|amd64)$/.test(platform)) {
    throw new Error(`Unsupported runtime target: ${platform}`);
  }
  const [os, arch] = platform.split('/');
  const nodeOS = os === 'windows' ? 'win' : os;
  const nodeArch = arch === 'amd64' ? 'x64' : arch;
  const archiveName = `node-v${nodeVersion}-${nodeOS}-${nodeArch}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
  const destination = path.join(root, 'resources', `${os}-${arch}`);
  const lock = await fs.readFile(path.join(root, 'runtime', 'package-lock.json'));
  const fingerprint = createHash('sha256').update(nodeVersion).update(lock).digest('hex');
  const marker = path.join(destination, '.runtime-ready');
  let ready = false;
  try {
    ready = (await fs.readFile(marker, 'utf8')) === fingerprint;
  } catch {
    /* first build */
  }
  if (ready) {
    await refreshSources(destination, platform);
    console.log(`Updated conversion sources: ${platform}`);
    return;
  }
  const cache = path.join(root, '.mygo', 'runtime-downloads');
  const archive = path.join(cache, archiveName);
  const baseURL = `https://nodejs.org/dist/v${nodeVersion}`;
  await fs.mkdir(cache, { recursive: true });
  const checksums = (await download(`${baseURL}/SHASUMS256.txt`)).toString();
  const expected = checksums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archiveName)?.[0];
  if (!expected) throw new Error(`Missing official checksum for ${archiveName}`);
  let data;
  try {
    data = await fs.readFile(archive);
  } catch {
    data = await download(`${baseURL}/${archiveName}`);
  }
  if (createHash('sha256').update(data).digest('hex') !== expected) {
    throw new Error(`SHA-256 verification failed: ${archiveName}. Remove ${archive} and retry.`);
  }
  await fs.writeFile(archive, data);
  const unpack = await fs.mkdtemp(path.join(cache, 'unpack-'));
  try {
    if (os === 'windows') new AdmZip(data).extractAllTo(unpack, true);
    else await run('tar', ['-xzf', archive, '-C', unpack]);
    const nodeDir = path.join(unpack, `node-v${nodeVersion}-${nodeOS}-${nodeArch}`);
    await fs.mkdir(path.join(destination, 'bin'), { recursive: true });
    const exe = os === 'windows' ? 'node.exe' : 'node';
    await fs.copyFile(
      path.join(nodeDir, os === 'windows' ? exe : `bin/${exe}`),
      path.join(destination, 'bin', exe)
    );
    if (os !== 'windows') await fs.chmod(path.join(destination, 'bin', exe), 0o755);
    await fs.copyFile(path.join(nodeDir, 'LICENSE'), path.join(destination, 'bin', 'NODE-LICENSE'));
  } finally {
    await fs.rm(unpack, { recursive: true, force: true });
  }
  const engine = path.join(destination, 'engine');
  await fs.mkdir(path.join(engine, 'src'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) {
    await fs.copyFile(path.join(root, 'runtime', name), path.join(engine, name));
  }
  // Invoke npm through Node, avoiding Windows .cmd shell quoting.
  const npmCLI = process.env.npm_execpath || (await findNpm());
  await run(
    process.execPath,
    [
      npmCLI,
      'ci',
      '--omit=dev',
      '--ignore-scripts',
      '--include=optional',
      `--os=${os === 'windows' ? 'win32' : os}`,
      `--cpu=${nodeArch}`
    ],
    { cwd: engine }
  );
  await refreshSources(destination, platform);
  await fs.writeFile(marker, fingerprint);
  console.log(`Prepared conversion runtime: ${platform}`);
}

async function findNpm() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* next */
    }
  }
  throw new Error('Run this command through npm run runtime:prepare');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareRuntime(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
