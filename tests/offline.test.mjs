import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildOffline } from '../scripts/build-offline.mjs';

const root = new URL('../', import.meta.url);
const workerSource = await readFile(new URL('sw.js', root), 'utf8');
const assets = JSON.parse(workerSource.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);

function worker(scope = 'https://example.test/Phase10/') {
  const listeners = new Map();
  const stores = new Map();
  let failing = false;
  let requests = 0;
  let claimed = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) {
          if (failing) throw new Error('One download failed');
          for (const request of requests) entries.set(request.url, { body: request.url, ok: true });
        },
        async match(key) { return entries.get(key); },
        async put(key, response) { entries.set(key, response); },
        async keys() { return [...entries.keys()].map(url => ({ url })); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  runInNewContext(workerSource, {
    URL, Set, Promise, caches,
    Request: class { constructor(url) { this.url = url; } },
    fetch: async () => { requests++; throw new Error('Offline'); },
    self: {
      registration: { scope },
      clients: { async claim() { claimed = true; } },
      skipWaiting() { throw new Error('An update must not replace a running game'); },
      addEventListener(type, callback) { listeners.set(type, callback); },
    },
  });
  async function lifecycle(type) {
    let pending;
    listeners.get(type)({ waitUntil(promise) { pending = promise; } });
    await pending;
  }
  function request(path, mode = 'cors', method = 'GET') {
    let response;
    listeners.get('fetch')({
      request: { url: new URL(path, scope).href, mode, method },
      respondWith(promise) { response = promise; },
    });
    return response;
  }
  async function ready() {
    let pending;
    let result;
    listeners.get('message')({ data: { type: 'OFFLINE_STATUS' },
      ports: [{ postMessage(value) { result = value.ready; } }],
      waitUntil(promise) { pending = promise; },
    });
    await pending;
    return result;
  }
  return { scope, stores, lifecycle, request, ready,
    failDownloads() { failing = true; },
    get requests() { return requests; }, get claimed() { return claimed; } };
}

test('installed app opens and serves every local asset without a network, including under a subpath', async () => {
  assert(assets.includes('public/games/gruselino/app/ui/game-app.js'));
  assert(assets.includes('public/games/gruselino/assets/gruselino.css'));
  assert(assets.includes('public/games/gruselino/assets/ghost.svg'));
  assert(assets.includes('src/game/phases-extreme.json'));
  for (let phase = 1; phase <= 10; phase++) assert(assets.includes(`public/assets/phase-extreme-${String(phase).padStart(2, '0')}.svg`));
  for (const path of ['app/ui/local-game.js', 'app/game/local-match.js', 'network/peer.js', 'network/signals.js', 'network/protocol.js']) assert(assets.includes('public/games/gruselino/' + path), path);
  for (const path of ['public/app/ui/local-phase10.js', 'public/app/game/local-match.js', 'public/app/network/peer.js']) assert(assets.includes(path), path);
  for (const scope of ['https://example.test/', 'https://example.test/Phase10/', 'https://example.test/Games/']) {
    const app = worker(scope);
    await app.lifecycle('install');
    assert.equal(await app.ready(), true);
    const home = await app.request('./?from=homescreen', 'navigate');
    assert.equal(home.body, scope + 'index.html');
    for (const fragment of ['#game', '#overview-extreme', '#phase-extreme-5']) {
      const link = await app.request('./?from=homescreen' + fragment, 'navigate');
      assert.equal(link.body, scope + 'index.html');
    }
    for (const asset of assets) {
      const response = await app.request(asset + '?test=1');
      assert.equal(response.body, scope + asset);
    }
    assert.equal(app.requests, 0);
  }
});

test('offline status becomes unavailable if a required file disappears from the cache', async () => {
  const app = worker();
  await app.lifecycle('install');
  app.stores.values().next().value.delete(app.scope + 'src/game/deck.json');
  assert.equal(await app.ready(), false);
});

test('activation removes only old versions belonging to this app scope', async () => {
  const app = worker();
  const ownOld = 'phase10:' + app.scope + ':old';
  const otherScope = 'phase10:https://example.test/:other';
  app.stores.set(ownOld, new Map());
  app.stores.set(otherScope, new Map());
  app.stores.set('another-app', new Map());
  await app.lifecycle('install');
  assert.equal(app.claimed, false);
  await app.lifecycle('activate');
  assert.equal(app.claimed, true);
  assert.equal(app.stores.has(ownOld), false);
  assert.equal(app.stores.has(otherScope), true);
  assert.equal(app.stores.has('another-app'), true);
  assert.equal(await app.ready(), true);
});

test('failed installation keeps the previous version and discards its incomplete new cache', async () => {
  const app = worker();
  const old = 'phase10:' + app.scope + ':old';
  app.stores.set(old, new Map([['saved', 'previous game assets']]));
  app.failDownloads();
  await assert.rejects(app.lifecycle('install'), /download failed/);
  assert.deepEqual([...app.stores.keys()], [old]);
});

test('foreign URLs, other apps, unknown pages and write requests bypass the cache', async () => {
  const app = worker();
  await app.lifecycle('install');
  for (const url of ['https://other.test/index.html', '/other/index.html', 'unknown.html', '/.git/config']) {
    assert.equal(app.request(url, 'navigate'), undefined);
  }
  assert.equal(app.request('index.html', 'cors', 'POST'), undefined);
});

test('manifest installs in its own folder and supplies real PNG icons at the declared sizes', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const scope of ['https://example.test/', 'https://example.test/Phase10/', 'https://example.test/Games/']) {
    for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], scope).href, scope);
  }
  for (const [path, size] of [...manifest.icons.map(icon => [icon.src, Number(icon.sizes.split('x')[0])]), ['public/assets/app-icon-180.png', 180]]) {
    const png = await readFile(new URL(path, root));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert(assets.includes(path.replace(/^\.\//, '')));
  }
});

test('build creates an isolated hosting folder and changes cache version when game content changes', async () => {
  const directory = await mkdtemp(tmpdir() + '/phase10-build-');
  const fixture = pathToFileURL(directory + '/');
  try {
    for (const path of ['index.html', 'manifest.webmanifest', 'src/ui/phase-cards.css', 'src/ui/game-table.css', 'src/game/deck.json', 'src/game/phases.json', 'src/game/phases-extreme.json', 'public/assets/card.svg', 'public/app/main.js']) {
      const target = new URL(path, fixture);
      await mkdir(new URL('./', target), { recursive: true });
      await writeFile(target, 'test-' + path);
    }
    await mkdir(new URL('src/storage/', fixture), { recursive: true });
    await writeFile(new URL('src/storage/service-worker.js', fixture), await readFile(new URL('src/storage/service-worker.js', root)));
    await writeFile(new URL('.env', fixture), 'must never be deployed');
    const first = await buildOffline(fixture);
    assert.equal((await buildOffline(fixture)).revision, first.revision);
    await writeFile(new URL('public/app/main.js', fixture), 'updated game');
    const changed = await buildOffline(fixture);
    assert.notEqual(changed.revision, first.revision);
    assert.equal(await readFile(new URL('dist/public/app/main.js', fixture), 'utf8'), 'updated game');
    await assert.rejects(readFile(new URL('dist/.env', fixture)), { code: 'ENOENT' });
    await assert.rejects(readFile(new URL('dist/src/storage/service-worker.js', fixture)), { code: 'ENOENT' });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('publication rejects hidden files, unexpected file types and symlinks in asset folders', async () => {
  const directory = await mkdtemp(tmpdir() + '/phase10-publication-');
  const fixture = pathToFileURL(directory + '/');
  try {
    for (const path of ['index.html', 'manifest.webmanifest', 'src/ui/phase-cards.css', 'src/ui/game-table.css', 'src/game/deck.json', 'src/game/phases.json', 'src/game/phases-extreme.json', 'public/assets/card.svg', 'public/app/main.js', 'src/storage/service-worker.js']) {
      const target = new URL(path, fixture);
      await mkdir(new URL('./', target), { recursive: true });
      await writeFile(target, 'test-' + path);
    }
    await mkdir(new URL('public/games/gruselino/', fixture), { recursive: true });
    for (const path of ['public/assets/.env', 'public/assets/private.pem', 'public/app/config.json', 'public/games/gruselino/.env', 'public/games/gruselino/private.pem']) {
      await writeFile(new URL(path, fixture), 'dummy private content');
      await assert.rejects(buildOffline(fixture), /nicht zur Veröffentlichung freigegeben/);
      await rm(new URL(path, fixture));
    }
    const hiddenDirectory = new URL('public/assets/.private/', fixture);
    await mkdir(hiddenDirectory);
    await assert.rejects(buildOffline(fixture), /nicht zur Veröffentlichung freigegeben/);
    await rm(hiddenDirectory, { recursive: true });
    const privateFile = new URL('private.txt', fixture);
    await writeFile(privateFile, 'dummy content outside the asset directory');
    const indexFile = new URL('index.html', fixture);
    await rm(indexFile);
    await symlink(privateFile, indexFile);
    await assert.rejects(buildOffline(fixture), /Kein regulärer Veröffentlichungs-Pfad/);
    await rm(indexFile);
    await writeFile(indexFile, 'test-index.html');
    const linkedAsset = new URL('public/assets/linked.svg', fixture);
    await symlink(privateFile, linkedAsset);
    await assert.rejects(buildOffline(fixture), /nicht zur Veröffentlichung freigegeben/);
    await rm(linkedAsset);
    const assetsDirectory = new URL('public/assets', fixture);
    await rm(assetsDirectory, { recursive: true });
    await mkdir(new URL('private-assets/', fixture));
    await symlink(new URL('private-assets/', fixture), assetsDirectory, 'dir');
    await assert.rejects(buildOffline(fixture), /Kein regulärer Veröffentlichungs-Pfad/);
    await unlink(assetsDirectory);
    const publicDirectory = new URL('public', fixture);
    await rm(publicDirectory, { recursive: true });
    await mkdir(new URL('outside-public/assets/', fixture), { recursive: true });
    await mkdir(new URL('outside-public/app/', fixture), { recursive: true });
    await symlink(new URL('outside-public/', fixture), publicDirectory, 'dir');
    await assert.rejects(buildOffline(fixture), /Kein regulärer Veröffentlichungs-Pfad/);
    await assert.rejects(readFile(new URL('dist/public/assets/linked.svg', fixture)), { code: 'ENOENT' });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
