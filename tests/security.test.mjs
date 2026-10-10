import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog, createGame, drawCard } from '../public/app/game/game.js';
import { loadGame } from '../public/app/storage/local-game.js';
import { readPhaseDefinitions } from '../public/app/game/phases.js';
import { renderGameTable } from '../public/app/ui/game-table.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const phases = readPhaseDefinitions(JSON.parse(await readFile(new URL('../src/game/phases.json', import.meta.url), 'utf8')));

test('card assets cannot reference external URLs, traverse folders or break HTML attributes', () => {
  for (const asset of ['https://attacker.invalid/track.svg', '//attacker.invalid/track.svg', '../private.svg', 'public/assets/../../private.svg', 'public/assets/card-red-01.svg" onerror="alert(1)']) {
    const forged = cards.map(card => ({ ...card }));
    forged[0].asset = asset;
    assert.throws(() => createCatalog(forged), /ungültige/);
  }
});

test('malicious text in an otherwise valid save remains text when the table renders', () => {
  const initial = createGame(catalog, 1, () => 0.999999);
  const state = drawCard(initial, catalog, initial.players[0].id, 'stock');
  const skip = state.players[0].hand.find(id => catalog.get(id).type === 'skip');
  assert(skip);
  state.players[1].name = '<svg onload=alert(1)>';
  state.players[1].id = 'bot"><img src=x onerror=alert(2)>';
  state.history = ['<img src=x onerror=alert(3)>'];
  const loaded = loadGame({ getItem: () => JSON.stringify(state) }, catalog);
  assert.equal(loaded.error, null);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const root = Object.assign(new EventTarget(), {
    dataset: {}, contains: () => false, querySelector: () => null, querySelectorAll: () => [],
  });
  globalThis.document = { activeElement: null };
  globalThis.window = {};
  try {
    renderGameTable(root, { state: loaded.state, catalog, phases, selected: [skip], target: null,
      message: '<script>alert(4)</script>', ordering: false, focusedCard: null }, {});
    assert(root.innerHTML.includes('&lt;svg onload=alert(1)&gt;'));
    assert(root.innerHTML.includes('bot&quot;&gt;&lt;img src=x onerror=alert(2)&gt;'));
    assert(root.innerHTML.includes('&lt;img src=x onerror=alert(3)&gt;'));
    assert(root.innerHTML.includes('&lt;script&gt;alert(4)&lt;/script&gt;'));
    assert(!root.innerHTML.includes('<svg onload'));
    assert(!root.innerHTML.includes('<img src=x'));
    assert(!root.innerHTML.includes('<script>'));
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
