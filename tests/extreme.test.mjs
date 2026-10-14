import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog, createGame, createHumanGame, assertGameState, layPhase, hitMeld, discardCard, nextRound } from '../public/app/game/game.js';
import { PHASE_GROUPS, EXTREME_PHASE_GROUPS, readPhaseDefinitions, createPhaseOrder, matchPhase, findPhase } from '../public/app/game/phases.js';
import { createBotView, chooseBotMove, phaseProgress } from '../public/app/ai/strategy.js';
import { loadGame, saveGame, STORAGE_KEY } from '../public/app/storage/local-game.js';
import { LocalMatch, readSnapshot } from '../public/app/game/local-match.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const definitions = JSON.parse(await readFile(new URL('../src/game/phases-extreme.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const ids = value => cards.filter(card => card.type === 'number' && card.value === value).map(card => card.id);
const run = (start, size) => Array.from({ length: size }, (_, i) => `red-${start + i}-1`);
const copy = value => JSON.parse(JSON.stringify(value));
const selections = [
  [...ids(7).slice(0, 5), ...ids(9).slice(0, 3)],
  [...ids(7).slice(0, 5), ...run(2, 4)],
  [...ids(8).slice(0, 5), ...run(2, 5)],
  run(2, 9), run(1, 10),
  [...ids(11).slice(0, 4), ...run(1, 6)],
  [...ids(4).slice(0, 5), ...ids(9).slice(0, 5)],
  run(1, 9),
  [...ids(5).slice(0, 6), ...ids(11).slice(0, 3)],
  [...ids(6).slice(0, 6), ...ids(12).slice(0, 4)],
];

function fixture(hand, phase = 1, bot = false, difficulty = 'easy') {
  const state = createGame(catalog, 1, () => .999999, difficulty, 'extreme');
  const rest = cards.map(card => card.id).filter(id => !hand.includes(id));
  const index = bot ? 1 : 0;
  state.players[index].hand = [...hand];
  while (state.players[index].hand.length < 11) state.players[index].hand.push(rest.shift());
  state.players[index].phase = phase;
  state.players[1 - index].hand = rest.splice(0, 10);
  state.players.forEach(player => { player.skipPending = false; player.skipProtected = false; });
  state.discard = [rest.pop()]; state.stock = rest; state.currentPlayer = index;
  state.stage = 'discard'; state.drawnCard = state.players[index].hand.at(-1);
  assertGameState(state, catalog); return state;
}

test('Extrem has ten displayed tasks, each harder than its classic counterpart and possible with ten cards', async () => {
  assert.equal(readPhaseDefinitions(definitions, 'extreme').length, 10);
  assert.deepEqual(EXTREME_PHASE_GROUPS, definitions.map(phase => phase.groups.map(({ kind, size }) => ({ kind, size }))));
  assert.deepEqual(EXTREME_PHASE_GROUPS[0], [{ kind: 'set', size: 5 }, { kind: 'set', size: 3 }]);
  for (let index = 0; index < 10; index++) {
    const count = EXTREME_PHASE_GROUPS[index].reduce((sum, group) => sum + group.size, 0);
    assert(count <= 10);
    assert(count > PHASE_GROUPS[index].reduce((sum, group) => sum + group.size, 0));
    const svg = await readFile(new URL(`../public/assets/phase-extreme-${String(index + 1).padStart(2, '0')}.svg`, import.meta.url), 'utf8');
    assert(svg.includes('EXTREM · PHASE')); assert(svg.includes(`${count} KARTEN`));
  }
  assert.throws(() => readPhaseDefinitions(definitions));
});

test('all ten Extrem phases accept disjoint legal cards and Jokers, and reject incomplete or duplicate selections', () => {
  for (const [index, selected] of selections.entries()) {
    const phase = index + 1;
    const groups = matchPhase([...selected].reverse(), phase, catalog, 'extreme');
    assert(groups, `Extrem phase ${phase}`);
    assert.deepEqual(new Set(groups.flatMap(group => group.cards)), new Set(selected));
    assert.equal(matchPhase(selected.slice(1), phase, catalog, 'extreme'), null);
    assert.equal(matchPhase([...selected, selected[0]], phase, catalog, 'extreme'), null);
    assert.equal(matchPhase(['skip-1', ...selected.slice(1)], phase, catalog, 'extreme'), null);
    assert(matchPhase(['wild-1', ...selected.slice(1)], phase, catalog, 'extreme'));
    assert(matchPhase(findPhase([...selected, 'skip-1'], phase, catalog, 'extreme'), phase, catalog, 'extreme'));
  }
  const classicFirst = [...ids(7).slice(0, 3), ...ids(9).slice(0, 3)];
  assert(matchPhase(classicFirst, 1, catalog));
  assert.equal(matchPhase(classicFirst, 1, catalog, 'extreme'), null);
});

test('an Extrem round enforces its phase, allows hits, scores and advances without changing the chosen set', () => {
  let state = fixture([...selections[0], ...ids(7).slice(5, 7), 'red-1-1']);
  assert.throws(() => layPhase(state, catalog, 'player-0', [...ids(7).slice(0, 3), ...ids(9).slice(0, 3)]), /vollständige Phase/);
  state = layPhase(state, catalog, 'player-0', selections[0]);
  assert.equal(state.players[0].hand.length, 3);
  state = hitMeld(state, catalog, 'player-0', ids(7).slice(5, 7), 'player-0', 0);
  state = discardCard(state, catalog, 'player-0', 'red-1-1', null);
  assert.equal(state.status, 'round-over'); assert.equal(state.players[0].score, 0); assert(state.players[1].score > 0);
  const next = nextRound(state, catalog, () => .999999);
  assert.equal(next.phaseSet, 'extreme'); assert.equal(next.players[0].phase, 2); assert.equal(next.players[1].phase, 1);
  assert(next.players.every(player => player.hand.length === 10)); assertGameState(next, catalog);
});

test('finishing the tenth Extrem phase ends the match', () => {
  const state = fixture([...selections[9], 'red-1-1'], 10);
  const laid = layPhase(state, catalog, 'player-0', selections[9]);
  const finished = discardCard(laid, catalog, 'player-0', 'red-1-1', null);
  assert.equal(finished.status, 'finished'); assert.equal(finished.winner, 'player-0');
  assert.throws(() => nextRound(finished, catalog));
});

test('both bot strengths search and assess the current Extrem task for all ten phases', () => {
  for (const difficulty of ['easy', 'strong']) for (const [index, selected] of selections.entries()) {
    const state = fixture(selected, index + 1, true, difficulty);
    const view = createBotView(state);
    assert.equal(view.phaseSet, 'extreme');
    const move = chooseBotMove(view, catalog);
    assert.equal(move.kind, 'lay'); assert(matchPhase(move.cards, index + 1, catalog, 'extreme'));
    assert.equal(phaseProgress(selected, index + 1, catalog, 'extreme'), selected.length);
    assertGameState(layPhase(state, catalog, view.id, move.cards), catalog);
  }
});

test('Extrem saves keep their variant and interrupted turn; version 3 saves migrate as classic without overwriting', () => {
  const state = layPhase(fixture(selections[0]), catalog, 'player-0', selections[0]);
  let saved;
  const storage = { getItem: key => { assert.equal(key, STORAGE_KEY); return saved; }, setItem: (key, value) => { assert.equal(key, STORAGE_KEY); saved = value; } };
  assert.equal(saveGame(storage, state, catalog), null);
  assert.deepEqual(loadGame(storage, catalog).state, state);
  const classicHand = [...ids(7).slice(0, 3), ...ids(9).slice(0, 3)];
  const classicState = fixture(classicHand); classicState.phaseSet = 'classic'; classicState.phaseOrder = createPhaseOrder('classic');
  const current = layPhase(classicState, catalog, 'player-0', classicHand);
  const { phaseSet, ...legacy } = current; legacy.version = 3;
  const raw = JSON.stringify(legacy);
  const loaded = loadGame({ getItem: () => raw, setItem: () => assert.fail('migration must not overwrite') }, catalog);
  assert.equal(loaded.error, null); assert.deepEqual(loaded.state, current);
  for (const change of [s => delete s.phaseSet, s => s.phaseSet = '<script>']) {
    const bad = copy(current); change(bad);
    assert.equal(loadGame({ getItem: () => JSON.stringify(bad) }, catalog).state, null);
  }
  assert.throws(() => assertGameState({ ...current, phaseSet: 'extreme', phaseOrder: createPhaseOrder('extreme') }, catalog), /Gruppe passt nicht/);
  assert.throws(() => createGame(catalog, 1, Math.random, 'easy', 'unknown'));
});

test('multiplayer snapshots carry the host variant and validate laid groups against it without leaking hands', () => {
  const state = fixture(selections[0]);
  Object.assign(state.players[1], { controller: 'human', botDifficulty: null });
  const match = new LocalMatch(catalog, state, 'ab'.repeat(16));
  const snapshot = match.snapshot('guest');
  assert.equal(snapshot.state.phaseSet, 'extreme'); assert.deepEqual(snapshot.state.players[0].hand, []);
  readSnapshot(snapshot, catalog, 'player-1');
  assert(match.dispatch('host', { type: 'phase10.action', id: 1, match: snapshot.match, revision: 0, action: { kind: 'lay', cards: selections[0] } }).changed);
  readSnapshot(match.snapshot('guest'), catalog, 'player-1');
  for (const mode of [undefined, 'unknown']) { const bad = copy(snapshot); bad.state.phaseSet = mode; assert.throws(() => readSnapshot(bad, catalog, 'player-1')); }
  const classic = createHumanGame(catalog, () => .999999);
  assert.equal(classic.phaseSet, 'classic');
  assert.equal(createHumanGame(catalog, () => .999999, 'extreme').phaseSet, 'extreme');
});
