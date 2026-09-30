// Explicit code/catalogue allowlist. Never recursively publish config or env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'web/public/scan-runtime');
// Clean only this generated directory; verify its resolved target first so a
// symlink cannot turn a frontend build into a recursive delete elsewhere.
if (fs.existsSync(target)) {
  const resolved = fs.realpathSync(target);
  const relative = path.relative(fs.realpathSync(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.basename(resolved) !== 'scan-runtime') {
    throw new Error('Generated runtime directory resolves outside the workspace');
  }
  fs.rmSync(target, { recursive: true, force: true });
}
const files = ['stage_hunter.py', 'connectors.py', 'regions.py', 'site_configs.py',
  'site_network.py', 'cloud/scan_worker.py', 'cloud/offer_history.py', 'cloud/browser_runtime.py',
  'config/sources.yaml', 'config/france_communes_coordinates.json'];
files.push(...fs.readdirSync(path.join(root, 'config')).filter(name => /^city_coordinates_[A-Z]{2}\.json\.gz$/.test(name)).sort().map(name => `config/${name}`));
// Support the published geography loader, which still reads public city JSON.
const cityDirectory = path.join(root, 'web/public/cities');
if (fs.existsSync(cityDirectory)) {
  files.push(...fs.readdirSync(cityDirectory).filter(name => /^[A-Z]{2}\.json$/.test(name)).sort().map(name => `web/public/cities/${name}`));
}
for (const name of files) {
  const output = path.join(target, name);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(root, name), output);
}
const vendor = 'vendor/rapidfuzz-3.14.6.zip';
fs.mkdirSync(path.join(target, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'web/scan-vendor/rapidfuzz-3.14.6.zip'), path.join(target, vendor));
files.push(vendor);
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ version: 1, files }));
