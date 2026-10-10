import { assertMeld, extendMeld, matchPhase, PHASE_GROUPS } from './phases.js';
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
  if (!isObject(value) || value.version !== 2 || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 6 ||
      !Number.isInteger(value.round) || (value.round as number) < 1 || !Number.isInteger(value.turn) || (value.turn as number) < 1 ||
      !Number.isInteger(value.currentPlayer) || (value.currentPlayer as number) < 0 || (value.currentPlayer as number) >= value.players.length ||
      (value.stage !== 'draw' && value.stage !== 'discard') || !['playing', 'round-over', 'finished'].includes(value.status as string) || typeof value.tieBreak !== 'boolean' || !Array.isArray(value.stock) || !Array.isArray(value.discard) ||
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
        !Number.isInteger(player.phase) || (player.phase as number) < 1 || (player.phase as number) > 10 ||
        !Number.isInteger(player.score) || (player.score as number) < 0 || !Array.isArray(player.melds) ||
        typeof player.skipPending !== 'boolean' || typeof player.skipProtected !== 'boolean' || (player.skipPending && player.skipProtected)) {
      throw new Error('Der Spielstand enthält einen ungültigen Spieler.');
    }
    const inactive = value.tieBreak && Array.isArray(value.finalists) && !value.finalists.includes(player.id);
    const maximum = index === value.currentPlayer && value.stage === 'discard' ? 11 : 10;
    if (inactive ? player.hand.length !== 0 : player.melds.length === 0 ? player.hand.length !== maximum : player.hand.length > maximum) {
      throw new Error('Die Handkartenzahl passt nicht zum Zugzustand.');
    }
    const requirements = PHASE_GROUPS[(player.phase as number) - 1]!;
    if (player.melds.length && (player.melds.length !== requirements.length || inactive)) throw new Error('Die ausgelegte Phase ist unvollständig.');
    player.melds.forEach((meld: unknown, groupIndex: number) => {
      assertMeld(meld, catalog);
      if (meld.kind !== requirements[groupIndex]!.kind || meld.cards.length < requirements[groupIndex]!.size) throw new Error('Die Gruppe passt nicht zur Phase.');
      owned.push(...meld.cards);
    });
    if (player.melds.length && !player.melds.some((meld: { cards: string[] }) => meld.cards.some(id => catalog.get(id)!.type === 'number'))) {
      throw new Error('Eine Phase braucht mindestens eine Zahlenkarte.');
    }
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
  if (value.tieBreak && value.finalists === null) throw new Error('Ungültige Stichrunde.');
  const active = value.players[value.currentPlayer as number];
  if ((value.stage === 'draw' && value.drawnCard !== null) ||
      (value.stage === 'discard' && (typeof value.drawnCard !== 'string' || ![...active.hand, ...value.players.flatMap((player: { melds: { cards: string[] }[] }) => player.melds.flatMap(meld => meld.cards))].includes(value.drawnCard)))) {
    throw new Error('Die gezogene Karte passt nicht zum Spielstand.');
  }
  if (value.finalists !== null && (!Array.isArray(value.finalists) || value.finalists.length < 2 || new Set(value.finalists).size !== value.finalists.length ||
      !value.finalists.every(id => ids.has(id)) || (value.tieBreak && !value.finalists.includes(active.id)))) throw new Error('Ungültige Stichrunde.');
  if (value.status === 'playing') {
    if (value.roundWinner !== null || value.winner !== null || value.players.some((player: { hand: string[]; id: string }) =>
      player.hand.length === 0 && (!value.tieBreak || !Array.isArray(value.finalists) || value.finalists.includes(player.id)))) throw new Error('Ungültige laufende Runde.');
  } else {
    const winner = value.players.find((player: { id: string }) => player.id === value.roundWinner);
    if (!winner || !winner.melds.length || (!value.tieBreak && winner.hand.length !== 0) || value.stage !== 'draw' ||
        (value.status === 'finished' ? !ids.has(value.winner as string) : value.winner !== null)) throw new Error('Ungültiges Rundenergebnis.');
  }

}

function clone(state: GameState): GameState {
  return { ...state, players: state.players.map(player => ({ ...player, hand: [...player.hand], melds: player.melds.map(meld => ({ ...meld, cards: [...meld.cards] })) })), stock: [...state.stock], discard: [...state.discard], history: [...state.history] };
}

function log(state: GameState, message: string): void {
  state.history = [...state.history, message].slice(-6);
}

function activePlayer(state: GameState, id: string, stage: GameState['stage']): Player {
  if (state.status !== 'playing') throw new Error('Diese Runde ist bereits beendet.');
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
    if (state.finalists && !state.finalists.includes(next.id)) continue;
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
    hand: [], phase: 1, score: 0, melds: [], skipPending: false, skipProtected: false,
  }));
  for (let round = 0; round < 10; round++) {
    for (const player of players) player.hand.push(stock.pop()!);
  }
  const firstDiscard = stock.pop()!;
  const state: GameState = { version: 2, status: 'playing', roundWinner: null, winner: null, tieBreak: false, finalists: null, round: 1, players, currentPlayer: 0, stage: 'draw', stock, discard: [firstDiscard], drawnCard: null, turn: 1, history: ['Karten gemischt. Jeder Spieler hat zehn Karten.'] };
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
  return state.players.filter((player, index) => index !== state.currentPlayer && (!state.finalists || state.finalists.includes(player.id)) && !player.skipPending && !player.skipProtected);
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
  if (player.hand.length === 0) finishRound(next, catalog);
  else beginNextTurn(next);
  assertGameState(next, catalog);
  return next;
}


function removePlayed(player: Player, ids: readonly string[]): void {
  player.hand = player.hand.filter(id => !ids.includes(id));
}

function checkSelection(player: Player, ids: readonly string[]): void {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !player.hand.includes(id))) {
    throw new Error('Wähle verschiedene Karten aus deiner eigenen Hand.');
  }
}

export function layPhase(state: GameState, catalog: Catalog, playerId: string, ids: readonly string[]): GameState {
  assertGameState(state, catalog);
  const active = activePlayer(state, playerId, 'discard');
  if (active.melds.length) throw new Error('Du hast deine Phase in dieser Runde bereits ausgelegt.');
  checkSelection(active, ids);
  const melds = matchPhase(ids, active.phase, catalog);
  if (!melds) throw new Error('Diese Auswahl bildet deine vollständige Phase nicht. Prüfe die Zahlen, Farben und Joker.');
  const next = clone(state);
  const player = next.players[next.currentPlayer]!;
  player.melds = melds;
  removePlayed(player, ids);
  log(next, `${player.name} legt Phase ${player.phase} aus.`);
  if (next.tieBreak || player.hand.length === 0) finishRound(next, catalog);
  assertGameState(next, catalog);
  return next;
}

export function hitMeld(state: GameState, catalog: Catalog, playerId: string, ids: readonly string[], ownerId: string, groupIndex: number): GameState {
  assertGameState(state, catalog);
  const active = activePlayer(state, playerId, 'discard');
  if (!active.melds.length) throw new Error('Lege zuerst deine eigene Phase aus.');
  checkSelection(active, ids);
  const owner = state.players.find(player => player.id === ownerId);
  const meld = Number.isInteger(groupIndex) && groupIndex >= 0 ? owner?.melds[groupIndex] : undefined;
  const extended = meld ? extendMeld(meld, ids, catalog) : null;
  if (!extended) throw new Error('Diese Karten passen nicht an die gewählte Gruppe.');
  const next = clone(state);
  next.players.find(player => player.id === ownerId)!.melds[groupIndex] = extended;
  const player = next.players[next.currentPlayer]!;
  removePlayed(player, ids);
  log(next, `${player.name} legt ${ids.length} ${ids.length === 1 ? 'Karte' : 'Karten'} bei ${owner!.name} an.`);
  if (player.hand.length === 0) finishRound(next, catalog);
  assertGameState(next, catalog);
  return next;
}

function cardPoints(card: Card): number {
  if (card.type === 'number') return card.value <= 9 ? 5 : 10;
  return card.type === 'skip' ? 15 : 25;
}

function finishRound(state: GameState, catalog: Catalog): void {
  const player = state.players[state.currentPlayer]!;
  state.roundWinner = player.id;
  state.status = 'round-over';
  state.stage = 'draw';
  state.drawnCard = null;
  state.players.forEach(other => { other.score += other.hand.reduce((total, id) => total + cardPoints(catalog.get(id)!), 0); });
  log(state, `${player.name} beendet Runde ${state.round}.`);
  const completed = state.players.filter(other => other.phase === 10 && other.melds.length);
  if (state.tieBreak) {
    state.winner = player.id;
  } else if (completed.length) {
    const lowest = Math.min(...completed.map(other => other.score));
    const tied = completed.filter(other => other.score === lowest);
    if (tied.length === 1) state.winner = tied[0]!.id;
    else {
      state.finalists = tied.map(other => other.id);
      // Participation changes when the next round is dealt, not before.
      log(state, 'Gleichstand nach Phase 10. Die punktgleichen Spieler spielen eine Stichrunde.');
    }
  }
  if (state.winner) state.status = 'finished';
}

export function nextRound(state: GameState, catalog: Catalog, random: Random = Math.random): GameState {
  assertGameState(state, catalog);
  if (state.status !== 'round-over') throw new Error('Eine neue Runde ist jetzt nicht möglich.');
  const next = clone(state);
  next.round++;
  next.status = 'playing';
  next.tieBreak = next.finalists !== null;
  next.roundWinner = null;
  next.winner = null;
  next.stock = shuffle([...catalog.keys()], random);
  next.discard = [];
  next.drawnCard = null;
  next.stage = 'draw';
  for (const player of next.players) {
    if (player.melds.length) player.phase = Math.min(10, player.phase + 1);
    player.hand = [];
    player.melds = [];
    player.skipPending = false;
    player.skipProtected = false;
  }
  for (let i = 0; i < 10; i++) {
    for (const player of next.players) {
      if (!next.finalists || next.finalists.includes(player.id)) player.hand.push(next.stock.pop()!);
    }
  }
  next.discard.push(next.stock.pop()!);
  next.currentPlayer = (next.round - 1) % next.players.length;
  while (next.finalists && !next.finalists.includes(next.players[next.currentPlayer]!.id)) next.currentPlayer = (next.currentPlayer + 1) % next.players.length;
  next.turn++;
  next.history = [`Runde ${next.round}: Karten neu gemischt und ausgeteilt.`];
  if (catalog.get(next.discard[0]!)!.type === 'skip') {
    const first = next.players[next.currentPlayer]!;
    first.skipProtected = true;
    log(next, `${first.name} setzt den ersten Zug aus.`);
    beginNextTurn(next);
  }
  assertGameState(next, catalog);
  return next;
}

export function reorderHand(state: GameState, catalog: Catalog, playerId: string, order: readonly string[]): GameState {
  assertGameState(state, catalog);
  const player = state.players.find(other => other.id === playerId);
  if (!player || order.length !== player.hand.length || new Set(order).size !== order.length || order.some(id => !player.hand.includes(id))) {
    throw new Error('Beim Ordnen müssen alle Handkarten genau einmal erhalten bleiben.');
  }
  const next = clone(state);
  next.players.find(other => other.id === playerId)!.hand = [...order];
  assertGameState(next, catalog);
  return next;
}

export function sortHand(state: GameState, catalog: Catalog, playerId: string, by: 'number' | 'color'): GameState {
  const player = state.players.find(other => other.id === playerId);
  if (!player || (by !== 'number' && by !== 'color')) throw new Error('Ungültige Sortierung.');
  const order = [...player.hand].sort((a, b) => {
    const first = catalog.get(a)!;
    const second = catalog.get(b)!;
    const rank = (card: Card): number => card.type === 'number' ? card.value : card.type === 'wild' ? 13 : 14;
    const color = COLORS.indexOf(first.color!) - COLORS.indexOf(second.color!);
    if (first.type === 'number' && second.type === 'number') return by === 'color' ? color || rank(first) - rank(second) : rank(first) - rank(second) || color;
    return rank(first) - rank(second);
  });
  return reorderHand(state, catalog, playerId, order);
}
