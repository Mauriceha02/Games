import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog, createGame, assertGameState, drawCard, discardCard, layPhase, hitMeld, nextRound, reorderHand, sortHand } from '../public/app/game/game.js';
import { PHASE_GROUPS, readPhaseDefinitions, matchPhase, findPhase, extendMeld } from '../public/app/game/phases.js';
import { loadGame, saveGame, STORAGE_KEY } from '../public/app/storage/local-game.js';
import { playBasicTurnStep } from '../public/app/ai/basic-turn.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const definitions = JSON.parse(await readFile(new URL('../src/game/phases.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const ids = value => cards.filter(card => card.type === 'number' && card.value === value).map(card => card.id);
const run = (start, length) => Array.from({ length }, (_, offset) => `red-${start + offset}-1`);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(hand, phase = 1, stage = 'discard') {
  const state = createGame(catalog, 2, () => 0.999999);
  const remaining = cards.map(card => card.id).filter(id => !hand.includes(id));
  state.players[0].hand = [...hand];
  while (state.players[0].hand.length < (stage === 'draw' ? 10 : 11)) state.players[0].hand.push(remaining.shift());
  state.players[0].phase = phase;
  state.players[1].hand = remaining.splice(0, 10);
  state.players[2].hand = remaining.splice(0, 10);
  state.discard = [remaining.pop()];
  state.stock = remaining;
  state.currentPlayer = 0;
  state.stage = stage;
  state.drawnCard = stage === 'discard' ? state.players[0].hand.at(-1) : null;
  assertGameState(state, catalog);
  return state;
}

const phase1 = [...ids(7).slice(0, 3), ...ids(9).slice(0, 3)];

test('the game requirements and displayed JSON agree for all ten phases', () => {
  assert.equal(readPhaseDefinitions(definitions).length, 10);
  assert.deepEqual(PHASE_GROUPS, definitions.map(phase => phase.groups.map(({ kind, size }) => ({ kind, size }))));
  assert.throws(() => readPhaseDefinitions(definitions.slice(0, 9)));
  const changed = clone(definitions); changed[0].groups[0].size = 4;
  assert.throws(() => readPhaseDefinitions(changed));
});

test('all ten phases accept legal selections and partition every physical card once', () => {
  const selections = [phase1, [...ids(7).slice(0, 3), ...run(2, 4)], [...ids(7).slice(0, 4), ...run(2, 4)],
    run(2, 7), run(2, 8), run(2, 9), [...ids(4).slice(0, 4), ...ids(9).slice(0, 4)],
    run(1, 7), [...ids(5).slice(0, 5), ...ids(11).slice(0, 2)], [...ids(6).slice(0, 5), ...ids(12).slice(0, 3)]];
  for (let index = 0; index < selections.length; index++) {
    const groups = matchPhase([...selections[index]].reverse(), index + 1, catalog);
    assert(groups, `Phase ${index + 1}`);
    assert.deepEqual(new Set(groups.flatMap(group => group.cards)), new Set(selections[index]));
    assert.equal(matchPhase(selections[index].slice(1), index + 1, catalog), null);
  }
});

test('sets may have equal values, extra matching cards and Jokers across groups', () => {
  assert(matchPhase(ids(7).slice(0, 6), 1, catalog));
  assert(matchPhase([...ids(7).slice(0, 4), ...ids(9).slice(0, 3)], 1, catalog));
  assert(matchPhase([...ids(7).slice(0, 1), 'wild-1', 'wild-2', 'wild-3', 'wild-4', 'wild-5'], 1, catalog));
  assert.equal(matchPhase(['wild-1', 'wild-2', 'wild-3', 'wild-4', 'wild-5', 'wild-6'], 1, catalog), null);
  assert.equal(matchPhase([...phase1, 'skip-1'], 1, catalog), null);
  assert.equal(matchPhase([...phase1, phase1[0]], 1, catalog), null);
  assert.equal(matchPhase([...phase1.slice(0, 5), 'unknown'], 1, catalog), null);
  assert.equal(matchPhase([...phase1, 'red-1-1'], 1, catalog), null);
});

test('runs reject duplicates, gaps and wrapping from twelve to one, and place Jokers in exact gaps', () => {
  assert.equal(matchPhase([...run(1, 6), 'blue-6-1'], 4, catalog), null);
  assert.equal(matchPhase([...run(1, 6), 'red-8-1'], 4, catalog), null);
  assert.equal(matchPhase([...run(8, 5), 'red-1-1', 'red-2-1'], 4, catalog), null);
  const groups = matchPhase(['red-2-1', 'red-3-1', 'wild-1', 'red-5-1', 'red-6-1', 'red-7-1', 'red-8-1'], 4, catalog);
  assert.equal(groups[0].value, 2);
  assert.equal(groups[0].cards[2], 'wild-1');
  assert(matchPhase([...run(1, 6), 'blue-7-1'], 4, catalog));
});

test('color phases permit different numbers and Jokers but reject a different natural color', () => {
  assert(matchPhase([...run(1, 6), 'wild-1'], 8, catalog));
  assert(matchPhase(['red-1-1', 'red-1-2', 'red-2-1', 'red-3-1', 'red-4-1', 'red-5-1', 'red-6-1'], 8, catalog));
  assert.equal(matchPhase([...run(1, 6), 'blue-7-1'], 8, catalog), null);
});

test('phase search uses disjoint cards, ignores skips and leaves the hand unchanged', () => {
  const hand = [...phase1, 'wild-1', 'skip-1', 'red-1-1'];
  const before = [...hand];
  const found = findPhase(hand, 1, catalog);
  assert(found); assert(matchPhase(found, 1, catalog));
  assert(found.every(id => catalog.get(id).type === 'number'));
  assert.deepEqual(hand, before);
  assert.equal(findPhase(run(1, 10), 1, catalog), null);
});

test('laying requires a drawn card and the complete current phase, then reduces the hand without ending the turn', () => {
  const before = fixture(phase1);
  assert.throws(() => layPhase(fixture(phase1, 1, 'draw'), catalog, 'player-0', phase1), /Ziehe zuerst/);
  assert.throws(() => layPhase(before, catalog, 'player-1', phase1), /nicht am Zug/);
  assert.throws(() => layPhase(before, catalog, 'player-0', phase1.slice(1)), /vollständige Phase/);
  assert.throws(() => layPhase(before, catalog, 'player-0', [...phase1, before.players[1].hand[0]]), /eigene/);
  const copy = clone(before);
  const laid = layPhase(before, catalog, 'player-0', phase1);
  assert.equal(laid.players[0].hand.length, 5);
  assert.equal(laid.players[0].melds.length, 2);
  assert.equal(laid.players[0].phase, 1);
  assert.equal(laid.stage, 'discard');
  assert.equal(laid.currentPlayer, 0);
  assert.deepEqual(before, copy);
  assertGameState(laid, catalog);
  assert.throws(() => layPhase(laid, catalog, 'player-0', laid.players[0].hand), /bereits ausgelegt/);
});

test('the newly drawn card can be laid and its saved turn resumes with fewer hand cards', () => {
  const state = fixture(phase1);
  state.drawnCard = phase1[0];
  const laid = layPhase(state, catalog, 'player-0', phase1);
  let raw = null;
  const storage = { getItem() { return raw; }, setItem(key, value) { raw = value; } };
  assert.equal(saveGame(storage, laid, catalog), null);
  const restored = loadGame(storage, catalog).state;
  assert.deepEqual(restored, laid);
  assert.throws(() => drawCard(restored, catalog, 'player-0', 'stock'), /bereits/);
  const card = restored.players[0].hand.find(id => catalog.get(id).type !== 'skip');
  assert.equal(discardCard(restored, catalog, 'player-0', card).players[0].hand.length, 4);
});

test('hitting needs an own phase, matches the selected target and can play multiple cards', () => {
  const extras = ids(7).slice(3, 7);
  const state = fixture([...phase1, ...extras, 'skip-1']);
  assert.throws(() => hitMeld(state, catalog, 'player-0', extras, 'player-0', 0), /eigene Phase/);
  const laid = layPhase(state, catalog, 'player-0', phase1);
  assert.throws(() => hitMeld(laid, catalog, 'player-0', extras, 'player-0', 1), /passen nicht/);
  assert.throws(() => hitMeld(laid, catalog, 'player-0', extras, 'missing', 0));
  const hit = hitMeld(laid, catalog, 'player-0', extras, 'player-0', 0);
  assert.equal(hit.players[0].hand.length, 1);
  assert.equal(hit.players[0].melds[0].cards.length, 7);
  const ended = discardCard(hit, catalog, 'player-0', 'skip-1', 'player-1');
  assert.equal(ended.status, 'round-over');
  assert.equal(ended.roundWinner, 'player-0');
  assert.equal(ended.players[0].score, 0);
  assertGameState(ended, catalog);
  assert.throws(() => drawCard(ended, catalog, 'player-1', 'stock'), /beendet/);
  const next = nextRound(ended, catalog, () => 0.999999);
  assert.equal(next.round, 2);
  assert.deepEqual(next.players.map(player => player.phase), [2, 1, 1]);
  assert(next.players.every(player => player.hand.length === 10 && !player.melds.length));
  assertGameState(next, catalog);
});

test('a run Joker remains fixed when cards are added at both ends', () => {
  const meld = matchPhase(['red-3-1', 'wild-1', 'red-5-1', 'red-6-1', 'red-7-1', 'red-8-1', 'red-9-1'], 4, catalog)[0];
  assert.equal(meld.cards[1], 'wild-1');
  const extended = extendMeld(meld, ['red-2-1', 'red-10-1'], catalog);
  assert.equal(extended.value, 2);
  assert.equal(extended.cards[2], 'wild-1');
  assert.equal(extendMeld(meld, ['red-4-1'], catalog), null);
  assert.equal(extendMeld(meld, ['red-1-1'], catalog), null);
  assert.equal(extendMeld(meld, ['skip-1'], catalog), null);
});

test('reordering and explicit sorting preserve cards, turn, phase and saved order', () => {
  const state = fixture(phase1, 1, 'draw');
  const original = clone(state);
  const order = [...state.players[0].hand].reverse();
  const moved = reorderHand(state, catalog, 'player-0', order);
  assert.deepEqual(moved.players[0].hand, order);
  assert.deepEqual(state, original);
  assert.equal(moved.stage, 'draw');
  assert.equal(moved.currentPlayer, state.currentPlayer);
  assert.deepEqual(moved.stock, state.stock);
  assert.throws(() => reorderHand(state, catalog, 'player-0', [...order.slice(1), order[1]]));
  assert.throws(() => reorderHand(state, catalog, 'player-0', order.slice(1)));
  const sorted = sortHand(state, catalog, 'player-0', 'number');
  const values = sorted.players[0].hand.map(id => catalog.get(id).value);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  const storage = { getItem: () => JSON.stringify(moved), setItem() {} };
  assert.deepEqual(loadGame(storage, catalog).state.players[0].hand, order);
});

test('old saves migrate without resetting the hand, piles or interrupted turn', () => {
  const current = fixture(phase1);
  const { status, roundWinner, winner, finalists, tieBreak, ...legacy } = current;
  legacy.version = 1;
  legacy.players = legacy.players.map(({ phase, score, melds, ...player }) => player);
  const raw = JSON.stringify(legacy);
  const storage = { getItem(key) { assert.equal(key, STORAGE_KEY); return raw; }, setItem() { throw new Error('should not overwrite'); } };
  const migrated = loadGame(storage, catalog);
  assert.equal(migrated.error, null);
  assert.deepEqual(migrated.state, current);
  const bad = clone(legacy); bad.players[0].hand.pop();
  assert.equal(loadGame({ getItem: () => JSON.stringify(bad) }, catalog).state, null);
});

test('corrupt melds, phase numbers and duplicate table cards are rejected', () => {
  const laid = layPhase(fixture(phase1), catalog, 'player-0', phase1);
  for (const change of [state => { state.players[0].phase = 11; }, state => { state.players[0].melds[0].value = 8; },
    state => { state.players[0].melds[1].cards[0] = state.players[0].melds[0].cards[0]; },
    state => { state.players[0].melds.pop(); }]) {
    const bad = clone(laid); change(bad); assert.throws(() => assertGameState(bad, catalog));
  }
});

test('the distribution across 10,000 seeded deals does not favor particular physical cards', () => {
  let seed = 782134;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const counts = new Map(cards.map(card => [card.id, 0]));
  for (let deal = 0; deal < 10000; deal++) {
    const state = createGame(catalog, 2, random);
    for (const id of state.players[0].hand) counts.set(id, counts.get(id) + 1);
  }
  const expected = 100000 / 108;
  const chiSquare = [...counts.values()].reduce((total, observed) => total + (observed - expected) ** 2 / expected, 0);
  assert(chiSquare < 180, `distribution chi-square: ${chiSquare}`);
  assert([...counts.values()].every(count => count > 700 && count < 1150));
});

function rebuildStock(state) {
  const held = [...state.discard, ...state.players.flatMap(player => [...player.hand, ...player.melds.flatMap(group => group.cards)])];
  assert.equal(new Set(held).size, held.length);
  state.stock = cards.map(card => card.id).filter(id => !held.includes(id));
  assertGameState(state, catalog);
  return state;
}

test('playing every card ends a round immediately and scores only remaining hand cards', () => {
  const state = fixture(run(1, 11), 4);
  const ended = layPhase(state, catalog, 'player-0', state.players[0].hand);
  assert.equal(ended.status, 'round-over');
  assert.deepEqual(ended.players.map(player => player.score), [0, 55, 65]);
  assert.equal(ended.players[0].melds[0].cards.length, 11);
  assertGameState(ended, catalog);
});

test('another player can hit a public phase and all players who laid advance after the round', () => {
  let state = fixture([...phase1, ...ids(7).slice(3, 7), 'red-1-1']);
  state = layPhase(state, catalog, 'player-0', phase1);
  const opponentPhase = [...ids(4).slice(0, 3), ...ids(5).slice(0, 3)];
  state.players[1].hand = ['yellow-7-2'];
  state.players[1].melds = matchPhase(opponentPhase, 1, catalog);
  rebuildStock(state);
  // The selected yellow 7 belongs to this opponent, and hits the human's first set.
  state.currentPlayer = 1; state.drawnCard = 'yellow-7-2';
  const hit = hitMeld(state, catalog, 'player-1', ['yellow-7-2'], 'player-0', 0);
  assert.equal(hit.status, 'round-over');
  assert.equal(hit.players[0].melds[0].cards.length, 4);
  const next = nextRound(hit, catalog, () => 0.999999);
  assert.deepEqual(next.players.map(player => player.phase), [2, 2, 1]);
});

test('finishing phase ten wins at the end of the round and prevents further rounds', () => {
  const selected = [...ids(6).slice(0, 5), ...ids(12).slice(0, 3)];
  let state = fixture([...selected, ...ids(6).slice(5, 8)], 10);
  state = layPhase(state, catalog, 'player-0', selected);
  state = hitMeld(state, catalog, 'player-0', state.players[0].hand, 'player-0', 0);
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'player-0');
  assert.throws(() => nextRound(state, catalog));
});

function withCompletedFinalists() {
  const state = fixture(run(1, 11), 4);
  const used = new Set(state.players[0].hand);
  const final = (a, b) => [...ids(a).filter(id => !used.has(id)).slice(0, 5), ...ids(b).filter(id => !used.has(id)).slice(0, 3)];
  state.players[1].phase = 10; state.players[1].melds = matchPhase(final(7, 9), 10, catalog); state.players[1].hand = ['blue-1-1', 'blue-2-1'];
  state.players[2].phase = 10; state.players[2].melds = matchPhase(final(4, 5), 10, catalog); state.players[2].hand = ['green-1-1', 'green-2-1'];
  rebuildStock(state);
  return state;
}

test('multiple phase-ten finishers are ranked by cumulative penalty points', () => {
  const state = withCompletedFinalists();
  state.players[1].score = 15;
  const ended = layPhase(state, catalog, 'player-0', state.players[0].hand);
  assert.equal(ended.winner, 'player-2');
  assert.equal(ended.status, 'finished');
});

test('equal phase-ten scores lead to a tie-break with only the tied players and first laid phase wins', () => {
  const state = withCompletedFinalists();
  const ended = layPhase(state, catalog, 'player-0', state.players[0].hand);
  assert.equal(ended.status, 'round-over');
  assert.deepEqual(ended.finalists, ['player-1', 'player-2']);
  let next = nextRound(ended, catalog, () => 0.999999);
  assert.equal(next.tieBreak, true);
  assert.deepEqual(next.players.map(player => player.hand.length), [0, 10, 10]);
  assert.equal(next.currentPlayer, 1);
  // Deal a legal phase-ten hand to the active finalist, conserving every card.
  const phase = [...ids(6).slice(0, 5), ...ids(12).slice(0, 3)];
  next.players[1].hand = [...phase, 'blue-1-1', 'blue-2-1'];
  next.players[2].hand = cards.map(card => card.id).filter(id => !next.players[1].hand.includes(id)).slice(0, 10);
  next.discard = ['skip-4'];
  rebuildStock(next);
  next = drawCard(next, catalog, 'player-1', 'stock');
  const finished = layPhase(next, catalog, 'player-1', phase);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.winner, 'player-1');
  assert(finished.players[1].hand.length > 0);
  assertGameState(finished, catalog);
});

test('basic computer moves lay a complete phase, hit matching cards, then discard', () => {
  const state = fixture([...phase1, ...ids(7).slice(3, 7), 'skip-1']);
  [state.players[0].hand, state.players[1].hand] = [state.players[1].hand, state.players[0].hand];
  state.currentPlayer = 1; state.drawnCard = 'skip-1';
  assertGameState(state, catalog);
  let current = playBasicTurnStep(state, catalog);
  assert.equal(current.players[1].melds.length, 2);
  while (current.status === 'playing' && current.currentPlayer === 1) current = playBasicTurnStep(current, catalog);
  assert.equal(current.status, 'round-over');
  assert.equal(current.roundWinner, 'player-1');
  assertGameState(current, catalog);
});
