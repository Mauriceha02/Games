import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shuffle } from '../public/app/game/shuffle.js';
import { createCatalog, createGame, assertGameState, drawCard, discardCard, eligibleSkipTargets } from '../public/app/game/game.js';
import { loadGame, saveGame, STORAGE_KEY } from '../public/app/storage/local-game.js';
import { playBasicTurnStep } from '../public/app/ai/basic-turn.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const unchangedOrder = () => 0.999999;
const copy = value => JSON.parse(JSON.stringify(value));

test('computer turns draw and discard separately, including after restoring a save', () => {
  const state = finishTurn(createGame(catalog, 2, unchangedOrder));
  const humanHand = [...state.players[0].hand];
  const active = state.currentPlayer;
  const drawn = playBasicTurnStep(state, catalog);
  assert.equal(drawn.stage, 'discard');
  assert.equal(drawn.players[active].hand.length, 11);
  const restored = JSON.parse(JSON.stringify(drawn));
  assertGameState(restored, catalog);
  let discarded = playBasicTurnStep(restored, catalog);
  while (discarded.status === 'playing' && discarded.currentPlayer === active) discarded = playBasicTurnStep(discarded, catalog);
  assert.equal(discarded.stage, 'draw');
  assert(discarded.players[active].hand.length <= 10);
  assert.deepEqual(discarded.players[0].hand, humanHand);
  assertGameState(discarded, catalog);
  assert.throws(() => playBasicTurnStep(createGame(catalog, 2, unchangedOrder), catalog));
});

test('a computer discarding a newly drawn skip selects a valid opponent', () => {
  const state = finishTurn(createGame(catalog, 2, unchangedOrder));
  const holder = state.players.find(player => player.hand.some(id => catalog.get(id).type === 'skip'));
  const skipIndex = holder.hand.findIndex(id => catalog.get(id).type === 'skip');
  const stockIndex = state.stock.length - 1;
  [holder.hand[skipIndex], state.stock[stockIndex]] = [state.stock[stockIndex], holder.hand[skipIndex]];
  assertGameState(state, catalog);
  const drawn = drawCard(state, catalog, state.players[state.currentPlayer].id, 'stock');
  assert.equal(catalog.get(drawn.drawnCard).type, 'skip');
  let discarded = playBasicTurnStep(drawn, catalog);
  while (discarded.status === 'playing' && discarded.currentPlayer === drawn.currentPlayer) discarded = playBasicTurnStep(discarded, catalog);
  assert.equal(catalog.get(discarded.discard.at(-1)).type, 'skip');
  assert(discarded.players.some(player => player.skipPending || player.skipProtected));
  assertGameState(discarded, catalog);
});

function seeded(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function gameWithOpening(type, computers = 2) {
  const ordered = [...cards];
  const openingIndex = ordered.length - (computers + 1) * 10 - 1;
  const specialIndex = ordered.findIndex(card => card.type === type);
  [ordered[openingIndex], ordered[specialIndex]] = [ordered[specialIndex], ordered[openingIndex]];
  return createGame(createCatalog(ordered), computers, unchangedOrder);
}

function finishTurn(state, random = unchangedOrder) {
  const player = state.players[state.currentPlayer];
  let next = drawCard(state, catalog, player.id, 'stock', random);
  const target = eligibleSkipTargets(next)[0];
  const hand = next.players[next.currentPlayer].hand;
  const id = hand.find(cardId => catalog.get(cardId).type !== 'skip') ?? hand.find(() => target);
  return discardCard(next, catalog, player.id, id, catalog.get(id).type === 'skip' ? target.id : null);
}

test('the catalog contains exactly two copies of every number/color and 8/4 specials', () => {
  assert.equal(catalog.size, 108);
  for (const color of ['red', 'blue', 'green', 'yellow']) {
    for (let value = 1; value <= 12; value++) {
      assert.equal([...catalog.values()].filter(card => card.color === color && card.value === value).length, 2);
    }
  }
  assert.equal(cards.filter(card => card.type === 'wild').length, 8);
  assert.equal(cards.filter(card => card.type === 'skip').length, 4);
  const duplicated = copy(cards);
  duplicated[0] = duplicated[1];
  assert.throws(() => createCatalog(duplicated));
  const invalidNumber = copy(cards);
  invalidNumber[0].value = 13;
  assert.throws(() => createCatalog(invalidNumber));
});

test('Fisher–Yates can produce all six permutations with equally many choices', () => {
  const input = ['a', 'b', 'c'];
  const outcomes = new Set();
  for (let first = 0; first < 3; first++) {
    for (let second = 0; second < 2; second++) {
      const values = [(first + 0.5) / 3, (second + 0.5) / 2];
      outcomes.add(shuffle(input, () => values.shift()).join(''));
    }
  }
  assert.equal(outcomes.size, 6);
  assert.deepEqual(input, ['a', 'b', 'c']);
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle(['a']), ['a']);
  for (const bad of [-0.1, 1, NaN]) assert.throws(() => shuffle(input, () => bad));
});

test('2–6 players receive exactly ten cards; the rest and one discard conserve all 108 cards', () => {
  for (let computers = 1; computers <= 5; computers++) {
    for (let seed = 1; seed <= 40; seed++) {
      const state = createGame(catalog, computers, seeded(seed));
      assert.equal(state.players.length, computers + 1);
      assert(state.players.every(player => player.hand.length === 10));
      assert.equal(state.discard.length, 1);
      assert.equal(state.stock.length, 108 - (computers + 1) * 10 - 1);
      assertGameState(state, catalog);
    }
  }
  assert.throws(() => createGame(catalog, 0));
  assert.throws(() => createGame(catalog, 6));
});

test('cards are dealt clockwise one at a time without changing the catalog', () => {
  const original = JSON.stringify(cards);
  const state = createGame(catalog, 2, unchangedOrder);
  assert.equal(state.players[0].hand[0], 'skip-4');
  assert.equal(state.players[1].hand[0], 'skip-3');
  assert.equal(state.players[2].hand[0], 'skip-2');
  assert.equal(state.players[0].hand[1], 'skip-1');
  assert.equal(JSON.stringify(cards), original);
});

test('drawing is mandatory and a second draw is rejected without mutating the game', () => {
  const state = gameWithOpening('number');
  const id = state.players[0].hand.find(cardId => catalog.get(cardId).type === 'number');
  assert.throws(() => discardCard(state, catalog, 'player-0', id), /Ziehe zuerst/);
  const before = copy(state);
  const drawn = drawCard(state, catalog, 'player-0', 'stock');
  assert.equal(drawn.players[0].hand.length, 11);
  assert.equal(drawn.stock.length, state.stock.length - 1);
  assert.equal(drawn.stage, 'discard');
  assert.throws(() => drawCard(drawn, catalog, 'player-0', 'stock'), /bereits/);
  assert.deepEqual(state, before);
});

test('discard returns the active hand to ten and advances exactly one player', () => {
  const state = gameWithOpening('number');
  const drawn = drawCard(state, catalog, 'player-0', 'stock');
  const id = drawn.players[0].hand.find(cardId => catalog.get(cardId).type === 'number');
  const before = copy(drawn);
  const discarded = discardCard(drawn, catalog, 'player-0', id);
  assert.equal(discarded.players[0].hand.length, 10);
  assert.equal(discarded.discard.at(-1), id);
  assert.equal(discarded.currentPlayer, 1);
  assert.equal(discarded.stage, 'draw');
  assert.equal(discarded.drawnCard, null);
  assert.deepEqual(drawn, before);
  assert.throws(() => discardCard(discarded, catalog, 'player-0', id));
});

test('other players and cards outside the current hand cannot be used', () => {
  const state = gameWithOpening('number');
  assert.throws(() => drawCard(state, catalog, 'player-1', 'stock'), /nicht am Zug/);
  const drawn = drawCard(state, catalog, 'player-0', 'stock');
  assert.throws(() => discardCard(drawn, catalog, 'player-1', drawn.players[1].hand[0]));
  assert.throws(() => discardCard(drawn, catalog, 'player-0', drawn.players[1].hand[0]), /nicht auf deiner Hand/);
  assert.throws(() => discardCard(drawn, catalog, 'player-0', 'unknown-card'));
  const normal = drawn.players[0].hand.find(id => catalog.get(id).type === 'number');
  assert.throws(() => discardCard(drawn, catalog, 'player-0', normal, 'player-1'), /Nur Aussetzen/);
});

test('the top numbered discard and an opening Joker may both be picked up', () => {
  for (const type of ['number', 'wild']) {
    const state = gameWithOpening(type);
    const top = state.discard.at(-1);
    const drawn = drawCard(state, catalog, 'player-0', 'discard');
    assert.equal(drawn.stock.length, state.stock.length);
    assert.equal(drawn.discard.length, 0);
    assert.equal(drawn.drawnCard, top);
    assert(drawn.players[0].hand.includes(top));
    assertGameState(drawn, catalog);
  }
});

test('opening Skip skips the first player and cannot be picked up', () => {
  const state = gameWithOpening('skip');
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.players[0].skipProtected, true);
  assert.throws(() => drawCard(state, catalog, 'player-1', 'discard'), /nicht.*aufgenommen/);
  assert.equal(drawCard(state, catalog, 'player-1', 'stock').players[1].hand.length, 11);
});

test('Skip needs an eligible opponent and ends the turn without a second discard', () => {
  const drawn = drawCard(gameWithOpening('number'), catalog, 'player-0', 'stock');
  const skip = drawn.players[0].hand.find(id => catalog.get(id).type === 'skip');
  assert.throws(() => discardCard(drawn, catalog, 'player-0', skip));
  assert.throws(() => discardCard(drawn, catalog, 'player-0', skip, 'player-0'));
  const state = discardCard(drawn, catalog, 'player-0', skip, 'player-1');
  assert.equal(state.currentPlayer, 2);
  assert.equal(state.players[0].hand.length, 10);
  assert.equal(state.players[1].skipPending, false);
  assert.equal(state.players[1].skipProtected, true);
  assert.equal(state.discard.at(-1), skip);
  assert(!eligibleSkipTargets(state).some(player => player.id === 'player-1'));
});

test('a skipped player must complete a normal turn before being skipped again', () => {
  let state = drawCard(gameWithOpening('number'), catalog, 'player-0', 'stock');
  const skip = state.players[0].hand.find(id => catalog.get(id).type === 'skip');
  state = discardCard(state, catalog, 'player-0', skip, 'player-1');
  const computerDraw = drawCard(state, catalog, 'player-2', 'stock');
  const computerSkip = computerDraw.players[2].hand.find(id => catalog.get(id).type === 'skip');
  assert.throws(() => discardCard(computerDraw, catalog, 'player-2', computerSkip, 'player-1'));
  state = finishTurn(state);
  state = finishTurn(state);
  assert.equal(state.currentPlayer, 1);
  state = finishTurn(state);
  assert.equal(state.players[1].skipProtected, false);
  assert(eligibleSkipTargets(state).some(player => player.id === 'player-1'));
});

test('an empty stock is recycled while its top discard stays visible', () => {
  let state = gameWithOpening('number');
  while (state.stock.length) state = finishTurn(state);
  const top = state.discard.at(-1);
  const totalAvailable = state.discard.length - 1;
  const drawn = drawCard(state, catalog, state.players[state.currentPlayer].id, 'stock', seeded(33));
  assert.deepEqual(drawn.discard, [top]);
  assert.equal(drawn.stock.length, totalAvailable - 1);
  assert.notEqual(drawn.drawnCard, top);
  assertGameState(drawn, catalog);
});

test('1,000 turns conserve every card and keep the 10 → 11 → 10 hand flow', () => {
  const random = seeded(8675309);
  let state = createGame(catalog, 5, random);
  for (let turn = 0; turn < 1000; turn++) {
    const player = state.players[state.currentPlayer];
    assert.equal(player.hand.length, 10);
    const useDiscard = turn % 5 === 0 && catalog.get(state.discard.at(-1))?.type !== 'skip';
    state = drawCard(state, catalog, player.id, useDiscard ? 'discard' : 'stock', random);
    assert.equal(state.players[state.currentPlayer].hand.length, 11);
    const target = eligibleSkipTargets(state)[0];
    const id = state.players[state.currentPlayer].hand.find(cardId => catalog.get(cardId).type !== 'skip' || target);
    state = discardCard(state, catalog, player.id, id, catalog.get(id).type === 'skip' ? target.id : null);
    assert(state.players.every(other => other.hand.length === 10));
    assertGameState(state, catalog);
  }
});

class MemoryStorage {
  value = null;
  getItem(key) { assert.equal(key, STORAGE_KEY); return this.value; }
  setItem(key, value) { assert.equal(key, STORAGE_KEY); this.value = value; }
}

test('saving after drawing preserves eleven cards and the mandatory discard across reloads', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadGame(storage, catalog), { state: null, error: null });
  const drawn = drawCard(gameWithOpening('number'), catalog, 'player-0', 'stock');
  assert.equal(saveGame(storage, drawn, catalog), null);
  const restored = loadGame(storage, catalog);
  assert.equal(restored.error, null);
  assert.deepEqual(restored.state, drawn);
  assert.throws(() => drawCard(restored.state, catalog, 'player-0', 'stock'), /bereits/);
  const id = drawn.players[0].hand.find(id => catalog.get(id).type === 'number');
  const next = discardCard(drawn, catalog, 'player-0', id);
  saveGame(storage, next, catalog);
  assert.deepEqual(loadGame(storage, catalog).state, next);
});

test('corrupt, duplicated and incompatible saved states are rejected without deleting them', () => {
  const storage = new MemoryStorage();
  const valid = gameWithOpening('number');
  const duplicate = copy(valid);
  duplicate.stock[0] = duplicate.players[0].hand[0];
  const wrongTurn = copy(valid);
  wrongTurn.stage = 'discard';
  for (const raw of ['broken json', '{}', JSON.stringify({ ...valid, version: 99 }), JSON.stringify(duplicate), JSON.stringify(wrongTurn)]) {
    storage.value = raw;
    assert.equal(loadGame(storage, catalog).state, null);
    assert(loadGame(storage, catalog).error);
    assert.equal(storage.value, raw);
  }
});

test('storage failures are reported instead of pretending that progress was saved', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert(loadGame(broken, catalog).error);
  assert.match(saveGame(broken, gameWithOpening('number'), catalog), /Speichern/);
});
