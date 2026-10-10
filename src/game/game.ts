import { shuffle } from './shuffle.js';
import type { Card, Catalog, Color, GameState, Player, Random } from './types.js';

const COLORS: Color[] = ['red', 'blue', 'green', 'yellow'];
const COLOR_NAMES: Record<Color, string> = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };

export function createCatalog(value: unknown): Catalog {
  if (!Array.isArray(value) || value.length !== 108) throw new Error('Das Deck muss 108 Spielkarten enthalten.');
  const catalog = new Map<string, Card>();
  const distribution = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.asset !== 'string' ||
        !/^public\/assets\/card-[a-z0-9-]+\.svg$/.test(item.asset) || catalog.has(item.id)) {
      throw new Error('Das Deck enthält eine ungültige oder doppelte Karte.');
    }
    if (item.type === 'number') {
      if (!COLORS.includes(item.color) || !Number.isInteger(item.value) || item.value < 1 || item.value > 12) {
        throw new Error('Ungültige Zahlenkarte.');
      }
    } else if ((item.type !== 'wild' && item.type !== 'skip') || item.color !== null || item.value !== null) {
      throw new Error('Ungültige Sonderkarte.');
    }
    const key = item.type === 'number' ? `${item.color}-${item.value}` : item.type;
    distribution.set(key, (distribution.get(key) ?? 0) + 1);
    catalog.set(item.id, { ...item });
  }
  for (const color of COLORS) {
    for (let number = 1; number <= 12; number++) {
      if (distribution.get(`${color}-${number}`) !== 2) throw new Error('Jede Zahl muss zweimal pro Farbe vorkommen.');
    }
  }
  if (distribution.get('wild') !== 8 || distribution.get('skip') !== 4) throw new Error('Die Sonderkarten sind falsch verteilt.');
  return catalog;
}

export function describeCard(card: Card): string {
  if (card.type === 'number') return `${COLOR_NAMES[card.color]} ${card.value}`;
  return card.type === 'wild' ? 'Joker' : 'Aussetzen';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate saved data as well as card ownership after each transition. */
export function assertGameState(value: unknown, catalog: Catalog): asserts value is GameState {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 6 ||
      !Number.isInteger(value.round) || (value.round as number) < 1 || !Number.isInteger(value.turn) || (value.turn as number) < 1 ||
      !Number.isInteger(value.currentPlayer) || (value.currentPlayer as number) < 0 || (value.currentPlayer as number) >= value.players.length ||
      (value.stage !== 'draw' && value.stage !== 'discard') || !Array.isArray(value.stock) || !Array.isArray(value.discard) ||
      !Array.isArray(value.history) || value.history.length > 6 || !value.history.every(entry => typeof entry === 'string' && entry.length <= 250)) {
    throw new Error('Der Spielstand hat ein ungültiges Format.');
  }
  const ids = new Set<string>();
  let humans = 0;
  const owned: unknown[] = [...value.stock, ...value.discard];
  value.players.forEach((player: unknown, index: number) => {
    if (!isObject(player) || typeof player.id !== 'string' || ids.has(player.id) || typeof player.name !== 'string' ||
        player.name.length < 1 || player.name.length > 40 || !Array.isArray(player.hand) ||
        (player.controller !== 'human' && player.controller !== 'computer') ||
        typeof player.skipPending !== 'boolean' || typeof player.skipProtected !== 'boolean' || (player.skipPending && player.skipProtected)) {
      throw new Error('Der Spielstand enthält einen ungültigen Spieler.');
    }
    // This first stage has drawing/discarding only; laying will relax these sizes later.
    const expected = index === value.currentPlayer && value.stage === 'discard' ? 11 : 10;
    if (player.hand.length !== expected) throw new Error('Die Handkartenzahl passt nicht zum Zugzustand.');
    if (index === value.currentPlayer && player.skipPending) throw new Error('Ein ausgesetzter Spieler kann nicht am Zug sein.');
    if (player.controller === 'human') {
      humans++;
      if (index !== 0) throw new Error('Der menschliche Spieler muss an erster Stelle stehen.');
    }
    ids.add(player.id);
    owned.push(...player.hand);
  });
  if (humans !== 1) throw new Error('Die Partie braucht genau einen menschlichen Spieler.');
  if (owned.length !== catalog.size || !owned.every(id => typeof id === 'string' && catalog.has(id)) || new Set(owned).size !== catalog.size) {
    throw new Error('Karten fehlen oder kommen mehrfach im Spiel vor.');
  }
  const active = value.players[value.currentPlayer as number];
  if ((value.stage === 'draw' && value.drawnCard !== null) ||
      (value.stage === 'discard' && (typeof value.drawnCard !== 'string' || !active.hand.includes(value.drawnCard)))) {
    throw new Error('Die gezogene Karte passt nicht zum Spielstand.');
  }
}

function clone(state: GameState): GameState {
  return { ...state, players: state.players.map(player => ({ ...player, hand: [...player.hand] })), stock: [...state.stock], discard: [...state.discard], history: [...state.history] };
}

function log(state: GameState, message: string): void {
  state.history = [...state.history, message].slice(-6);
}

function activePlayer(state: GameState, id: string, stage: GameState['stage']): Player {
  const player = state.players[state.currentPlayer]!;
  if (player.id !== id) throw new Error('Du bist gerade nicht am Zug.');
  if (state.stage !== stage) throw new Error(stage === 'draw' ? 'Du hast bereits eine Karte gezogen.' : 'Ziehe zuerst eine Karte.');
  return player;
}

function beginNextTurn(state: GameState): void {
  state.stage = 'draw';
  state.drawnCard = null;
  do {
    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    state.turn++;
    const next = state.players[state.currentPlayer]!;
    if (!next.skipPending) return;
    next.skipPending = false;
    next.skipProtected = true;
    log(state, `${next.name} setzt diesen Zug aus.`);
  } while (true);
}

export function createGame(catalog: Catalog, computerCount = 2, random: Random = Math.random): GameState {
  if (!Number.isInteger(computerCount) || computerCount < 1 || computerCount > 5) throw new Error('Wähle ein bis fünf Computergegner.');
  const stock = shuffle([...catalog.keys()], random);
  const players: Player[] = Array.from({ length: computerCount + 1 }, (_, i) => ({
    id: `player-${i}`, name: i === 0 ? 'Du' : `Computer ${i}`, controller: i === 0 ? 'human' : 'computer',
    hand: [], skipPending: false, skipProtected: false,
  }));
  for (let round = 0; round < 10; round++) {
    for (const player of players) player.hand.push(stock.pop()!);
  }
  const firstDiscard = stock.pop()!;
  const state: GameState = { version: 1, round: 1, players, currentPlayer: 0, stage: 'draw', stock, discard: [firstDiscard], drawnCard: null, turn: 1, history: ['Karten gemischt. Jeder Spieler hat zehn Karten.'] };
  if (catalog.get(firstDiscard)!.type === 'skip') {
    players[0]!.skipProtected = true;
    log(state, 'Aussetzen liegt zu Beginn offen. Dein erster Zug entfällt.');
    beginNextTurn(state);
  }
  assertGameState(state, catalog);
  return state;
}

export function drawCard(state: GameState, catalog: Catalog, playerId: string, source: 'stock' | 'discard', random: Random = Math.random): GameState {
  assertGameState(state, catalog);
  activePlayer(state, playerId, 'draw');
  if (source !== 'stock' && source !== 'discard') throw new Error('Ungültiger Kartenstapel.');
  const next = clone(state);
  const player = next.players[next.currentPlayer]!;
  if (source === 'stock' && next.stock.length === 0) {
    if (next.discard.length < 2) throw new Error('Es gibt keine Karten zum Nachziehen.');
    const top = next.discard.pop()!;
    next.stock = shuffle(next.discard, random);
    next.discard = [top];
    log(next, 'Der Ablagestapel wurde neu gemischt. Die oberste Karte bleibt offen liegen.');
  }
  const pile = source === 'stock' ? next.stock : next.discard;
  const id = pile[pile.length - 1];
  if (!id) throw new Error('Dieser Stapel ist leer.');
  if (source === 'discard' && catalog.get(id)!.type === 'skip') throw new Error('Aussetzen darf nicht vom Ablagestapel aufgenommen werden.');
  pile.pop();
  player.hand.push(id);
  next.drawnCard = id;
  next.stage = 'discard';
  log(next, `${player.name === 'Du' ? 'Du ziehst' : `${player.name} zieht`} vom ${source === 'stock' ? 'Nachziehstapel' : 'Ablagestapel'}.`);
  assertGameState(next, catalog);
  return next;
}

export function eligibleSkipTargets(state: GameState): Player[] {
  return state.players.filter((player, index) => index !== state.currentPlayer && !player.skipPending && !player.skipProtected);
}

export function discardCard(state: GameState, catalog: Catalog, playerId: string, cardId: string, targetId: string | null = null): GameState {
  assertGameState(state, catalog);
  const current = activePlayer(state, playerId, 'discard');
  if (!current.hand.includes(cardId)) throw new Error('Diese Karte ist nicht auf deiner Hand.');
  const card = catalog.get(cardId)!;
  if (card.type === 'skip') {
    if (!eligibleSkipTargets(state).some(player => player.id === targetId)) throw new Error('Wähle einen Spieler, der aussetzen darf.');
  } else if (targetId !== null) throw new Error('Nur Aussetzen-Karten haben einen Zielspieler.');
  const next = clone(state);
  const player = next.players[next.currentPlayer]!;
  player.hand.splice(player.hand.indexOf(cardId), 1);
  player.skipProtected = false;
  next.discard.push(cardId);
  log(next, `${player.name === 'Du' ? 'Du wirfst' : `${player.name} wirft`} ${describeCard(card)} ab.`);
  if (card.type === 'skip') {
    const target = next.players.find(other => other.id === targetId)!;
    target.skipPending = true;
    log(next, `${target.name} muss einen Zug aussetzen.`);
  }
  beginNextTurn(next);
  assertGameState(next, catalog);
  return next;
}
