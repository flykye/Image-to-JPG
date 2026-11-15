import { prepareRuntime, run } from './prepare-runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { packageCLI } from './build-cli.mjs';
import { obsoletePackages } from './clean.mjs';

const [command = 'dev', ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(command)) throw new Error(`Unknown command: ${command}`);
const platformIndex = args.indexOf('-platform');
const targets = platformIndex >= 0 ? args[platformIndex + 1].split(',') : [undefined];
for (const target of targets) await prepareRuntime(target);
await run(process.execPath, ['node_modules/mygo-cli/bin/mygo.js', command, ...args]);
if (command === 'build') {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const builtTargets = targets[0]
    ? targets
    : [
        `${process.platform === 'win32' ? 'windows' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch}`
      ];
  for (const target of builtTargets) await packageCLI(target, true);
  for (const target of builtTargets.filter((value) => value.startsWith('windows/'))) {
    const dir = path.resolve('dist', target.replace('/', '-'));
    const archivePath = path.join(
      dir,
      `image-to-jpg-${pkg.version}-${target.replace('/', '-')}-portable.zip`
    );
    const zip = new AdmZip();
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.endsWith('.zip') || entry.name.includes('-setup-')) continue;
      const source = path.join(dir, entry.name);
      if (entry.isDirectory()) zip.addLocalFolder(source, entry.name);
      else zip.addLocalFile(source);
    }
    zip.writeZip(archivePath);
    console.log(`Portable Windows package: ${archivePath}`);
  }
  // Remove superseded archives only after all requested builds succeeded.
  for (const target of builtTargets) {
    for (const file of await obsoletePackages(
      path.resolve('dist', target.replace('/', '-')),
      pkg.version
    ))
      await fs.rm(file);
  }
}
