import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog, createGame, assertGameState, layPhase, discardCard, nextRound } from '../public/app/game/game.js';
import { assertPhaseOrder, createPhaseOrder, phaseTask, phaseGroups, matchPhase, findPhase, readPhaseDefinitions } from '../public/app/game/phases.js';
import { createBotView, chooseBotMove, phaseProgress } from '../public/app/ai/strategy.js';
import { LocalMatch, readSnapshot } from '../public/app/game/local-match.js';
import { loadGame, saveGame, STORAGE_KEY } from '../public/app/storage/local-game.js';
import { renderGameTable } from '../public/app/ui/game-table.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const phases = {
  classic: readPhaseDefinitions(JSON.parse(await readFile(new URL('../src/game/phases.json', import.meta.url), 'utf8'))),
  extreme: readPhaseDefinitions(JSON.parse(await readFile(new URL('../src/game/phases-extreme.json', import.meta.url), 'utf8')), 'extreme'),
};
const order = [
  { set: 'classic', phase: 8 }, { set: 'extreme', phase: 5 },
  { set: 'classic', phase: 1 }, { set: 'extreme', phase: 2 },
  { set: 'classic', phase: 3 }, { set: 'extreme', phase: 7 },
  { set: 'classic', phase: 4 }, { set: 'extreme', phase: 8 },
  { set: 'classic', phase: 9 }, { set: 'extreme', phase: 10 },
];
const copy = value => JSON.parse(JSON.stringify(value));
const ids = value => cards.filter(card => card.type === 'number' && card.value === value).map(card => card.id);
const run = (start, size) => Array.from({ length: size }, (_, index) => `red-${start + index}-1`);
const selections = [
  run(1, 7), run(1, 10), [...ids(7).slice(0, 3), ...ids(9).slice(0, 3)],
  [...ids(7).slice(0, 5), ...run(2, 4)], [...ids(8).slice(0, 4), ...run(2, 4)],
  [...ids(4).slice(0, 5), ...ids(9).slice(0, 5)], run(3, 7), run(1, 9),
  [...ids(7).slice(0, 5), ...ids(9).slice(0, 2)], [...ids(6).slice(0, 6), ...ids(12).slice(0, 4)],
];
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function fixture(hand = selections[0], phase = 1, difficulty = null) {
  const state = createGame(catalog, 1, () => .99999, difficulty ?? 'easy', 'mixed');
  state.phaseOrder = copy(order);
  const current = difficulty ? 1 : 0;
  const rest = cards.map(card => card.id).filter(id => !hand.includes(id));
  state.players[current].hand = [...hand];
  while (state.players[current].hand.length < 11) state.players[current].hand.push(rest.shift());
  state.players[current].phase = phase;
  state.players[1 - current].hand = rest.splice(0, 10);
  state.players.forEach(player => { player.skipPending = false; player.skipProtected = false; });
  state.stock = rest; state.discard = [state.stock.pop()]; state.currentPlayer = current;
  state.stage = 'discard'; state.drawnCard = state.players[current].hand.at(-1);
  assertGameState(state, catalog);
  return state;
}

test('mixed games contain five tasks from each set in random order, without equivalent tasks twice', () => {
  const firstTasks = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const sequence = createPhaseOrder('mixed', seeded(seed));
    assertPhaseOrder(sequence, 'mixed');
    assert.equal(sequence.length, 10);
    assert.equal(sequence.filter(task => task.set === 'classic').length, 5);
    assert.equal(sequence.filter(task => task.set === 'extreme').length, 5);
    assert.equal(new Set(sequence.map(task => JSON.stringify(phaseGroups(task.phase, task.set)))).size, 10);
    firstTasks.add(`${sequence[0].set}:${sequence[0].phase}`);
    const state = createGame(catalog, 2, seeded(seed), 'mixed', 'mixed');
    assertPhaseOrder(state.phaseOrder, 'mixed'); assertGameState(state, catalog);
  }
  assert(firstTasks.has('classic:8'), 'classic Phase 8 can be the first task');
  assert(firstTasks.has('extreme:8'), 'Extrem Phase 8 can be the first task');
  assert(firstTasks.size > 10);
  for (const set of ['classic', 'extreme']) {
    assert.deepEqual(createPhaseOrder(set), Array.from({ length: 10 }, (_, index) => ({ set, phase: index + 1 })));
  }
});

test('shuffled source phases determine the cards required at every progress step', () => {
  for (const [index, selected] of selections.entries()) {
    const task = order[index];
    assert.deepEqual(phaseTask(index + 1, 'mixed', order), task);
    assert.deepEqual(phaseGroups(index + 1, 'mixed', order), phaseGroups(task.phase, task.set));
    assert(matchPhase(selected, index + 1, catalog, 'mixed', order));
    assert.equal(matchPhase(selected.slice(1), index + 1, catalog, 'mixed', order), null);
    assert.equal(matchPhase([...selected, selected[0]], index + 1, catalog, 'mixed', order), null);
    const withJoker = ['wild-1', ...selected.slice(1)];
    assert(matchPhase(withJoker, index + 1, catalog, 'mixed', order));
    assert(findPhase([...selected, 'skip-1'], index + 1, catalog, 'mixed', order));
    const laid = layPhase(fixture(selected, index + 1), catalog, 'player-0', selected);
    assertGameState(laid, catalog);
    assert.deepEqual(laid.phaseOrder, order);
  }
  assert.equal(matchPhase(selections[0], 1, catalog), null);
  assert.throws(() => phaseGroups(1, 'mixed'), /Phasenfolge fehlt/);
});

test('completing a round advances progress while retaining the party task order; the tenth task can finish the game', () => {
  const initial = fixture([...run(1, 10), 'red-1-2']);
  const finishedRound = layPhase(initial, catalog, 'player-0', initial.players[0].hand);
  assert.equal(finishedRound.status, 'round-over');
  const next = nextRound(finishedRound, catalog, () => .99999);
  assert.equal(next.players[0].phase, 2); assert.equal(next.players[1].phase, 1);
  assert.deepEqual(next.phaseOrder, initial.phaseOrder);
  assert.deepEqual(phaseTask(2, next.phaseSet, next.phaseOrder), { set: 'extreme', phase: 5 });
  let final = layPhase(fixture(selections[9], 10), catalog, 'player-0', selections[9]);
  final = discardCard(final, catalog, 'player-0', final.players[0].hand[0]);
  assert.equal(final.status, 'finished'); assert.equal(final.winner, 'player-0');
  assert.deepEqual(final.phaseOrder, order); assert.throws(() => nextRound(final, catalog));
});

test('both bot strengths follow the shuffled tasks and receive an independent copy of the public order', () => {
  for (const difficulty of ['easy', 'strong']) for (const [index, selected] of selections.entries()) {
    const state = fixture(selected, index + 1, difficulty);
    const view = createBotView(state);
    assert.equal(view.phaseSet, 'mixed'); assert.deepEqual(view.phaseOrder, order);
    const move = chooseBotMove(view, catalog);
    assert.equal(move.kind, 'lay');
    assert(matchPhase(move.cards, view.phase, catalog, 'mixed', order));
    assert.equal(phaseProgress(selected, view.phase, catalog, 'mixed', order), selected.length);
    assertGameState(layPhase(state, catalog, view.id, move.cards), catalog);
    view.phaseOrder[0].phase = 1;
    assert.deepEqual(state.phaseOrder, order);
  }
});

test('mixed saves retain the exact order, hand order and current laid phase across reloads', () => {
  const state = layPhase(fixture(), catalog, 'player-0', selections[0]);
  let raw = null;
  const storage = { getItem: key => { assert.equal(key, STORAGE_KEY); return raw; }, setItem: (key, value) => { assert.equal(key, STORAGE_KEY); raw = value; } };
  assert.equal(saveGame(storage, state, catalog), null);
  assert.deepEqual(loadGame(storage, catalog).state, state);
  assert.deepEqual(JSON.parse(raw).phaseOrder, order);
});

for (const set of ['classic', 'extreme']) test(`version 4 ${set} saves migrate without rewriting their cards or stored data`, () => {
  const current = createGame(catalog, 2, () => .99999, 'mixed', set);
  const { phaseOrder, ...legacy } = current; legacy.version = 4;
  const raw = JSON.stringify(legacy);
  const storage = { getItem: () => raw, setItem: () => assert.fail('loading must not overwrite the save') };
  assert.deepEqual(loadGame(storage, catalog), { state: current, error: null });
  assert.equal(storage.getItem(), raw);
});

test('missing, injected, duplicate, unbalanced and out-of-range task orders are rejected', () => {
  const state = fixture();
  for (const mutate of [
    value => delete value.phaseOrder,
    value => value.phaseOrder.pop(),
    value => value.phaseOrder.push({ set: 'classic', phase: 2 }),
    value => value.phaseOrder[0].set = 'mixed',
    value => value.phaseOrder[0].set = '<svg onload=alert(1)>',
    value => value.phaseOrder[0].phase = 0,
    value => value.phaseOrder[0].phase = 11,
    value => value.phaseOrder[0].phase = 1.5,
    value => value.phaseOrder[0] = null,
    value => value.phaseOrder[0] = value.phaseOrder[1],
    value => value.phaseOrder[0] = { set: 'extreme', phase: 3 },
  ]) {
    const bad = copy(state); mutate(bad);
    assert.throws(() => assertGameState(bad, catalog));
    assert.equal(loadGame({ getItem: () => JSON.stringify(bad) }, catalog).state, null);
  }
  const repeated = copy(order); repeated[0] = { set: 'classic', phase: 6 }; repeated[1] = { set: 'extreme', phase: 4 };
  assert.throws(() => assertPhaseOrder(repeated, 'mixed'), /Phasenfolge/);
  assert.throws(() => assertPhaseOrder(order, 'classic'), /Phasenfolge/);
});

test('multiplayer shares the host order, hides the other hand and rejects attempts to replace the plan', () => {
  const state = fixture(); Object.assign(state.players[1], { controller: 'human', botDifficulty: null });
  const match = new LocalMatch(catalog, state, 'ab'.repeat(16));
  const host = match.snapshot('host'); const guest = match.snapshot('guest');
  assert.deepEqual(host.state.phaseOrder, guest.state.phaseOrder);
  assert.deepEqual(guest.state.phaseOrder, order); assert.deepEqual(guest.state.players[0].hand, []);
  readSnapshot(guest, catalog, 'player-1');
  assert.equal(match.dispatch('guest', { type: 'phase10.action', id: 1, match: guest.match, revision: 0, action: { kind: 'change-order', phaseOrder: copy(order).reverse() } }).changed, false);
  assert.deepEqual(match.snapshot('guest').state.phaseOrder, order);
  assert(match.dispatch('host', { type: 'phase10.action', id: 1, match: host.match, revision: 0, action: { kind: 'lay', cards: selections[0] } }).changed);
  const laid = match.snapshot('guest'); readSnapshot(laid, catalog, 'player-1');
  assert.equal(laid.state.players[0].melds[0].kind, 'color');
  for (const mutate of [value => delete value.state.phaseOrder, value => value.state.phaseOrder[0].phase = 11, value => value.state.phaseOrder.reverse()]) {
    const bad = copy(laid); mutate(bad); assert.throws(() => readSnapshot(bad, catalog, 'player-1'));
  }
  guest.state.phaseOrder[0].phase = 1; assert.deepEqual(match.snapshot('guest').state.phaseOrder, order);
});

test('the table displays source cards, progress numbers, all ten tasks and the mixed option', () => {
  const previous = { document: globalThis.document, window: globalThis.window };
  const root = Object.assign(new EventTarget(), { dataset: {}, contains: () => false, querySelector: () => null, querySelectorAll: () => [] });
  globalThis.document = { activeElement: null }; globalThis.window = {};
  try {
    for (const index of [0, 1]) {
      const state = fixture(selections[index], index + 1);
      const task = order[index];
      renderGameTable(root, { state, catalog, phases, selected: selections[index], target: null, message: '', ordering: false, focusedCard: null }, {});
      assert(root.innerHTML.includes(`Phase ${index + 1} · ${phases[task.set][task.phase - 1].title}`));
      assert(root.innerHTML.includes(`./public/assets/phase-${task.set === 'extreme' ? 'extreme-' : ''}${String(task.phase).padStart(2, '0')}.svg`));
      assert(root.innerHTML.includes('Deine Phasenfolge')); assert.equal((root.innerHTML.match(/aria-current="step"/g) ?? []).length, 1);
      assert(root.innerHTML.includes('<option value="mixed" selected>Gemischt</option>'));
      const button = root.innerHTML.match(/<button[^>]*id="lay-phase"[^>]*>/)[0]; assert(!button.includes(' disabled'));
    }
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; }
});
