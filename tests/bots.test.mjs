import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog, createGame, assertGameState, drawCard, discardCard, setBotDifficulty, nextRound } from '../public/app/game/game.js';
import { chooseBotMove, createBotView, phaseProgress } from '../public/app/ai/strategy.js';
import { playBasicTurnStep } from '../public/app/ai/basic-turn.js';
import { matchPhase } from '../public/app/game/phases.js';
import { loadGame, saveGame } from '../public/app/storage/local-game.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const ids = value => cards.filter(card => card.type === 'number' && card.value === value).map(card => card.id);
const run = (start, length) => Array.from({ length }, (_, i) => `red-${start + i}-1`);
const copy = value => JSON.parse(JSON.stringify(value));

function view(hand, { phase = 1, difficulty = 'easy', melds = [], stage = 'discard', table = null, opponents = null, topDiscard = null } = {}) {
  return { id: 'bot', phase, difficulty, hand, melds, stage, table: table ?? melds.map((meld, group) => ({ owner: 'bot', group, meld })),
    opponents: opponents ?? [{ id: 'next', phase: 1, score: 0, handCount: 10, melds: [], skipPending: false, skipProtected: false }],
    topDiscard, canDrawStock: true };
}

function fixture(hand, phase = 1, difficulty = 'easy') {
  const state = createGame(catalog, 2, () => 0.999999, difficulty);
  const rest = cards.map(card => card.id).filter(id => !hand.includes(id));
  state.players[1].hand = [...hand];
  while (state.players[1].hand.length < 11) state.players[1].hand.push(rest.shift());
  state.players[1].phase = phase;
  state.players[0].hand = rest.splice(0, 10);
  state.players[2].hand = rest.splice(0, 10);
  state.discard = [rest.pop()]; state.stock = rest;
  state.currentPlayer = 1; state.stage = 'discard'; state.drawnCard = state.players[1].hand.at(-1);
  state.players.forEach(player => { player.skipPending = false; player.skipProtected = false; });
  assertGameState(state, catalog);
  return state;
}

function seeded(seed) {
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
}

for (const difficulty of ['easy', 'strong']) {
  test(`${difficulty}: a freshly drawn Joker is retained when a number can be discarded`, () => {
    const state = fixture([...run(1, 10), 'wild-1'], 1, difficulty);
    state.drawnCard = 'wild-1';
    const next = playBasicTurnStep(state, catalog);
    assert.equal(catalog.get(next.discard.at(-1)).type, 'number');
    assert(next.players[1].hand.includes('wild-1'));
    assertGameState(next, catalog);
  });

  test(`${difficulty}: a Joker on the discard pile is picked up`, () => {
    const move = chooseBotMove(view(run(1, 10), { difficulty, stage: 'draw', topDiscard: 'wild-1' }), catalog);
    assert.deepEqual(move, { kind: 'draw', source: 'discard' });
  });

  test(`${difficulty}: do not pick up a Joker just to discard it immediately with a blocked only-specials hand`, () => {
    const opponents = [{ id: 'protected', phase: 1, score: 0, handCount: 10, melds: [], skipPending: false, skipProtected: true }];
    const hand = [...Array.from({ length: 7 }, (_, i) => `wild-${i + 1}`), 'skip-1', 'skip-2', 'skip-3'];
    const move = chooseBotMove(view(hand, { difficulty, opponents, stage: 'draw', topDiscard: 'wild-8' }), catalog);
    assert.deepEqual(move, { kind: 'draw', source: 'stock' });
  });

  test(`${difficulty}: a Skip is played against a legal opponent, never thrown away without a target`, () => {
    const move = chooseBotMove(view([...run(1, 9), 'wild-1', 'skip-1'], { difficulty }), catalog);
    assert.deepEqual(move, { kind: 'discard', card: 'skip-1', target: 'next' });
    const protectedOpponent = { id: 'protected', phase: 1, score: 0, handCount: 10, melds: [], skipPending: false, skipProtected: true };
    const blocked = chooseBotMove(view([...run(1, 9), 'wild-1', 'skip-1'], { difficulty, opponents: [protectedOpponent] }), catalog);
    assert.equal(catalog.get(blocked.card).type, 'number');
  });

  test(`${difficulty}: a complete phase is laid before discarding or playing Skip`, () => {
    const hand = [...ids(7).slice(0, 2), 'wild-1', ...ids(9).slice(0, 3), 'skip-1', 'red-1-1'];
    const move = chooseBotMove(view(hand, { difficulty }), catalog);
    assert.equal(move.kind, 'lay'); assert(matchPhase(move.cards, 1, catalog));
    assert(move.cards.includes('wild-1'));
  });

  test(`${difficulty}: fitting numbers and Jokers are hit on another player's public phase`, () => {
    const own = matchPhase([...ids(7).slice(0, 3), ...ids(9).slice(0, 3)], 1, catalog);
    const others = matchPhase(run(3, 7), 4, catalog);
    const table = [...own.map((meld, group) => ({ owner: 'bot', group, meld })), { owner: 'other', group: 0, meld: others[0] }];
    const move = chooseBotMove(view(['red-10-1', 'red-1-1'], { difficulty, melds: own, table }), catalog);
    assert.equal(move.kind, 'hit'); assert.equal(move.owner, 'other'); assert(move.cards.includes('red-10-1'));
    const joker = chooseBotMove(view(['wild-1', 'skip-1'], { difficulty, melds: own, table }), catalog);
    assert.equal(joker.kind, 'hit'); assert(joker.cards.includes('wild-1'));
  });

  test(`${difficulty}: hitting a Joker with its natural neighbor can bridge a gap`, () => {
    const melds = matchPhase(run(3, 7), 4, catalog);
    const move = chooseBotMove(view(['wild-1', 'red-11-1', 'skip-1'], { difficulty, phase: 4, melds }), catalog);
    assert.equal(move.kind, 'hit'); assert.deepEqual(new Set(move.cards), new Set(['wild-1', 'red-11-1']));
  });

  test(`${difficulty}: when no other move is legal, the mandatory discard does not freeze the game`, () => {
    const opponents = [{ id: 'protected', phase: 1, score: 0, handCount: 10, melds: [], skipPending: false, skipProtected: true }];
    const hand = [...Array.from({ length: 8 }, (_, i) => `wild-${i + 1}`), 'skip-1', 'skip-2', 'skip-3'];
    const move = chooseBotMove(view(hand, { difficulty, opponents }), catalog);
    assert.equal(move.kind, 'discard'); assert.equal(catalog.get(move.card).type, 'wild'); assert.equal(move.target, null);
  });

  test(`${difficulty}: retain a legal discard instead of hitting the last non-Skip while all opponents are protected`, () => {
    const melds = matchPhase([...ids(7).slice(0, 3), ...ids(9).slice(0, 3)], 1, catalog);
    const opponents = [{ id: 'protected', phase: 1, score: 0, handCount: 1, melds: [], skipPending: false, skipProtected: true }];
    const move = chooseBotMove(view(['yellow-7-2', 'skip-1'], { difficulty, melds, opponents }), catalog);
    assert.deepEqual(move, { kind: 'discard', card: 'yellow-7-2', target: null });
  });
}

test('strong retains progress toward the complete set + run while easy uses local card patterns', () => {
  const hand = ['red-3-1', 'blue-3-1', 'green-3-1', 'red-4-1', 'blue-4-1', 'green-4-1', 'red-6-1', 'red-8-1', 'red-10-1', 'red-12-1', 'wild-1'];
  const move = chooseBotMove(view(hand, { phase: 3, difficulty: 'strong' }), catalog);
  assert.equal(move.kind, 'discard');
  const best = Math.max(...hand.filter(id => catalog.get(id).type === 'number').map(id => phaseProgress(hand.filter(other => other !== id), 3, catalog)));
  assert.equal(phaseProgress(hand.filter(id => id !== move.card), 3, catalog), best);
});

test('strong avoids an immediately useful discard even before laying its own phase', () => {
  const publicMelds = matchPhase([...ids(12).slice(0, 3), ...ids(9).slice(0, 3)], 1, catalog);
  const opponents = [{ id: 'next', phase: 1, score: 0, handCount: 2, melds: publicMelds, skipPending: false, skipProtected: false }];
  const table = publicMelds.map((meld, group) => ({ owner: 'next', group, meld }));
  const hand = ['yellow-12-1', 'red-2-1', 'red-3-1', 'red-4-1', 'red-6-1', 'red-8-1', 'red-10-1', 'blue-2-1', 'green-6-1', 'yellow-8-1', 'wild-1'];
  const move = chooseBotMove(view(hand, { difficulty: 'strong', opponents, table }), catalog);
  assert.equal(move.kind, 'discard'); assert.notEqual(catalog.get(move.card).value, 12); assert.notEqual(catalog.get(move.card).value, 9);
  const easy = chooseBotMove(view(hand, { difficulty: 'easy', opponents, table }), catalog);
  assert.equal(catalog.get(easy.card).value, 12);
});

test('strong targets the opponent closest to going out; easy chooses the next legal opponent', () => {
  const melds = matchPhase([...ids(7).slice(0, 3), ...ids(9).slice(0, 3)], 1, catalog);
  const opponents = [{ id: 'next', phase: 8, score: 0, handCount: 10, melds: [], skipPending: false, skipProtected: false },
    { id: 'dangerous', phase: 2, score: 50, handCount: 1, melds, skipPending: false, skipProtected: false }];
  const hand = [...run(1, 10), 'skip-1'];
  assert.equal(chooseBotMove(view(hand, { opponents, difficulty: 'strong' }), catalog).target, 'dangerous');
  assert.equal(chooseBotMove(view(hand, { opponents, difficulty: 'easy' }), catalog).target, 'next');
  opponents[1].skipProtected = true;
  assert.equal(chooseBotMove(view(hand, { opponents, difficulty: 'strong' }), catalog).target, 'next');
});

test('strong takes a discard that fills a missing run slot even without an adjacent number', () => {
  const hand = [...ids(1).slice(0, 3), ...ids(5).slice(0, 3), ...ids(7).slice(0, 4)];
  // Phase 6: the 3 fills another slot in 1–9 without being adjacent to 1, 5 or 7.
  assert.equal(chooseBotMove(view(hand, { phase: 6, difficulty: 'strong', stage: 'draw', topDiscard: 'red-3-1' }), catalog).source, 'discard');
  assert.equal(chooseBotMove(view(hand, { phase: 6, difficulty: 'easy', stage: 'draw', topDiscard: 'red-3-1' }), catalog).source, 'stock');
});

test('phase progress counts Jokers and physical cards once across both required groups', () => {
  assert.equal(phaseProgress(['red-7-1', 'blue-7-1', 'wild-1'], 1, catalog), 3);
  assert.equal(phaseProgress([...ids(7).slice(0, 3), ...ids(9).slice(0, 3)], 1, catalog), 6);
  assert.equal(phaseProgress(['wild-1', 'wild-2', 'wild-3', 'wild-4', 'wild-5', 'wild-6'], 1, catalog), 5);
  assert.equal(phaseProgress(['red-3-1', 'red-3-2', 'blue-3-1', 'red-4-1', 'red-5-1', 'red-6-1'], 2, catalog), 6);
  assert.equal(phaseProgress(['red-1-1', 'blue-2-1', 'red-4-1', 'wild-1'], 4, catalog), 4);
  assert.equal(phaseProgress(['red-1-1', 'red-2-1', 'blue-3-1', 'wild-1'], 8, catalog), 3);
});

test('bot views omit hidden opponents hands and the stock order, and decisions cannot depend on them', () => {
  const state = fixture([...run(1, 10), 'wild-1'], 1, 'strong');
  const first = createBotView(state);
  assert(first.opponents.every(player => !('hand' in player)));
  assert(!('stock' in first));
  const swapped = copy(state);
  [swapped.players[0].hand[0], swapped.players[2].hand[0]] = [swapped.players[2].hand[0], swapped.players[0].hand[0]];
  swapped.stock.reverse();
  assertGameState(swapped, catalog);
  assert.deepEqual(createBotView(swapped), first);
  assert.deepEqual(chooseBotMove(first, catalog), chooseBotMove(createBotView(swapped), catalog));
  first.hand.pop(); assert.equal(state.players[1].hand.length, 11);
});

test('easy, strong and mixed opponents can be selected and changed without touching the game progress', () => {
  const original = createGame(catalog, 3, () => 0.999999, 'mixed');
  assert.deepEqual(original.players.map(player => player.botDifficulty), [null, 'easy', 'strong', 'easy']);
  const before = copy(original);
  const strong = setBotDifficulty(original, catalog, 'strong');
  assert(strong.players.slice(1).every(player => player.botDifficulty === 'strong'));
  assert.deepEqual(original, before);
  const strip = state => ({ ...state, players: state.players.map(({ botDifficulty, ...player }) => player) });
  assert.deepEqual(strip(strong), strip(original));
  assert.throws(() => createGame(catalog, 2, Math.random, 'invalid'));
  assert.throws(() => setBotDifficulty(original, catalog, 'invalid'));
  const bad = copy(strong); bad.players[1].botDifficulty = 'invalid';
  assert.throws(() => assertGameState(bad, catalog));
  let raw = null;
  const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
  saveGame(storage, strong, catalog);
  assert.deepEqual(loadGame(storage, catalog).state, strong);
});

test('previous saves retain their cards, laid phases and round when migrating to easy bots', () => {
  const state = fixture([...run(1, 10), 'wild-1']);
  state.players[0].phase = 4;
  state.players[0].melds = matchPhase(Array.from({ length: 7 }, (_, i) => `green-${i + 1}-1`), 4, catalog);
  state.players[0].hand = state.players[0].hand.slice(0, 4);
  const held = [...state.discard, ...state.players.flatMap(player => [...player.hand, ...player.melds.flatMap(meld => meld.cards)])];
  state.stock = cards.map(card => card.id).filter(id => !held.includes(id));
  assertGameState(state, catalog);
  state.version = 2;
  state.players = state.players.map(({ botDifficulty, ...player }) => player);
  const raw = JSON.stringify(state);
  const loaded = loadGame({ getItem: () => raw }, catalog);
  assert.equal(loaded.error, null);
  assert.equal(loaded.state.version, 3);
  assert.deepEqual(loaded.state.players[1].hand, state.players[1].hand);
  assert.deepEqual(loaded.state.players[0].melds, state.players[0].melds);
  assert.equal(loaded.state.players[0].phase, 4);
  assert.equal(loaded.state.players[1].botDifficulty, 'easy');
  assert.equal(loaded.state.stage, 'discard');
});

test('both strengths play many legal turns while conserving every card and avoiding needless Joker discards', () => {
  for (const difficulty of ['easy', 'strong']) {
    const random = seeded(76543);
    let state = createGame(catalog, 3, random, difficulty);
    let completedRounds = 0;
    for (let step = 0; step < 700 && state.status !== 'finished'; step++) {
      if (state.status === 'round-over') { state = nextRound(state, catalog, random); assert(state.players.slice(1).every(player => player.botDifficulty === difficulty)); completedRounds++; continue; }
      const player = state.players[state.currentPlayer];
      if (player.controller === 'human') {
        if (state.stage === 'draw') state = drawCard(state, catalog, player.id, 'stock', random);
        else {
          const card = player.hand.find(id => catalog.get(id).type === 'number') ?? player.hand.find(id => catalog.get(id).type === 'wild');
          state = discardCard(state, catalog, player.id, card);
        }
      } else {
        const view = createBotView(state);
        const move = chooseBotMove(view, catalog);
        if (move.kind === 'discard' && catalog.get(move.card).type === 'wild') {
          assert(!player.hand.some(id => catalog.get(id).type === 'number'));
          assert(view.opponents.every(other => other.skipPending || other.skipProtected) || !player.hand.some(id => catalog.get(id).type === 'skip'));
        }
        state = playBasicTurnStep(state, catalog);
      }
      assertGameState(state, catalog);
    }
    assert(completedRounds > 0, `${difficulty} completed no rounds`);
  }
});
