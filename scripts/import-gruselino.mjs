import { readFile, readdir, mkdir, copyFile, rm, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const { gruselino } = JSON.parse(await readFile(new URL('games.json', root), 'utf8'));
if (gruselino.repository !== 'Mauriceha02/Gruselino' || !/^[a-f0-9]{40}$/.test(gruselino.revision)) throw new Error('Ungültige Gruselino-Version in games.json.');
const path = resolve(process.env.GRUSELINO_SOURCE ?? fileURLToPath(new URL('../Gruselino/', root)));
const source = pathToFileURL(path + '/');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (head !== gruselino.revision) throw new Error(`Gruselino muss auf Commit ${gruselino.revision} stehen. Lokales Repository: ${path}`);
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: source, encoding: 'utf8' }).trim()) throw new Error('Gruselino hat uncommittete Änderungen. Erst prüfen und committen, dann games.json aktualisieren.');
execFileSync('npm', ['test'], { cwd: source, stdio: 'inherit' });
const destination = new URL('public/games/gruselino/', root);
await rm(destination, { recursive: true, force: true });
const allowed = new Set(['.js', '.css', '.svg', '.png']);
async function copy(directory = '') {
  const folder = new URL(`bundle/${directory}`, source);
  const stat = await lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Ungültiger Gruselino-Bundle-Ordner.');
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!directory && entry.name === 'bundle.json') continue;
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error('Ungültige Gruselino-Bundle-Datei.');
    const name = `${directory}${entry.name}`;
    if (entry.isDirectory()) await copy(`${name}/`);
    else if (entry.isFile() && allowed.has(extname(entry.name))) {
      const target = new URL(name, destination);
      await mkdir(new URL('./', target), { recursive: true });
      await copyFile(new URL(`bundle/${name}`, source), target);
    } else throw new Error(`Nicht zur Veröffentlichung freigegeben: ${name}`);
  }
}
await copy();
// Both games use the same pinned transport; each game keeps its own rules and UI.
const network = new URL('public/app/network/', root);
await mkdir(network, { recursive: true });
for (const name of ['peer', 'protocol', 'signals']) {
  await copyFile(new URL(`network/${name}.js`, destination), new URL(`${name}.js`, network));
}
console.log(`Gruselino eingebunden: ${head.slice(0, 7)}.`);
