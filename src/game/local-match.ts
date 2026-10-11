import { assertGameState, createHumanGame, drawCard, discardCard, layPhase, hitMeld, nextRound } from './game.js';
import { assertMeld, PHASE_GROUPS } from './phases.js';
import type { Catalog, GameState } from './types.js';
import type { Role } from '../network/transport.js';

export type VisibleGameState = Omit<GameState, 'stock'> & { stockCount: number; handCounts: Record<string, number> };
export interface Snapshot { version: 1; match: string; revision: number; viewer: string; state: VisibleGameState }
export type GameAction =
  | { kind: 'draw'; source: 'stock' | 'discard' }
  | { kind: 'discard'; card: string; target: string | null }
  | { kind: 'lay'; cards: string[] }
  | { kind: 'hit'; cards: string[]; owner: string; group: number }
  | { kind: 'next-round' };
export interface Request { type: 'phase10.action'; id: number; match: string; revision: number; action: GameAction }
export interface Receipt { type: 'phase10.receipt'; id: number; error: string | null }
const playerId = (role: Role): string => role === 'host' ? 'player-0' : 'player-1';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max = 1000000): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const ids = ['player-0', 'player-1'];
const validId = (value: unknown): value is string => typeof value === 'string' && ids.includes(value);
export const newMatchId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export class LocalMatch {
  private revision = 0;
  private handled: Record<Role, number> = { host: 0, guest: 0 };
  constructor(private catalog: Catalog, private state: GameState = createHumanGame(catalog), private id = newMatchId()) {
    assertGameState(state, catalog);
    if (!/^[a-f0-9]{32}$/.test(id) || state.players.length !== 2 || state.players.some((player, index) => player.id !== ids[index] || player.controller !== 'human')) throw new Error('Ungültige gemeinsame Partie.');
    this.state = JSON.parse(JSON.stringify(state)) as GameState;
  }
  snapshot(role: Role): Snapshot {
    const viewer = playerId(role);
    const { stock, ...rest } = this.state;
    const visible: VisibleGameState = {
      ...rest, stockCount: stock.length,
      handCounts: Object.fromEntries(this.state.players.map(player => [player.id, player.hand.length])),
      players: this.state.players.map(player => ({ ...player, hand: player.id === viewer ? player.hand : [] })),
      drawnCard: this.state.players[this.state.currentPlayer]!.id === viewer ? this.state.drawnCard : null,
    };
    return JSON.parse(JSON.stringify({ version: 1, match: this.id, revision: this.revision, viewer, state: visible })) as Snapshot;
  }
  dispatch(role: Role, value: unknown): { receipt: Receipt; changed: boolean } {
    if ((role !== 'host' && role !== 'guest') || !record(value) || value.type !== 'phase10.action' || !integer(value.id, 1)) throw new Error('Ungültige Spielaktion.');
    const receipt: Receipt = { type: 'phase10.receipt', id: value.id, error: null };
    if (value.id <= this.handled[role]) return { receipt: { ...receipt, error: 'Diese Aktion wurde bereits verarbeitet.' }, changed: false };
    if (value.id !== this.handled[role] + 1) throw new Error('Ungültige Aktionsreihenfolge.');
    this.handled[role] = value.id;
    try {
      if (value.match !== this.id || value.revision !== this.revision) throw new Error('Der Spielstand hat sich geändert. Bitte versuche den Zug erneut.');
      const action = readAction(value.action, this.catalog);
      const player = playerId(role);
      let next: GameState;
      if (action.kind === 'draw') next = drawCard(this.state, this.catalog, player, action.source);
      else if (action.kind === 'discard') next = discardCard(this.state, this.catalog, player, action.card, action.target);
      else if (action.kind === 'lay') next = layPhase(this.state, this.catalog, player, action.cards);
      else if (action.kind === 'hit') next = hitMeld(this.state, this.catalog, player, action.cards, action.owner, action.group);
      else {
        if (role !== 'host') throw new Error('Der Gastgeber startet die nächste Runde.');
        next = nextRound(this.state, this.catalog);
      }
      this.state = next; this.revision++;
      return { receipt, changed: true };
    } catch (error) { return { receipt: { ...receipt, error: error instanceof Error ? error.message : 'Dieser Zug ist nicht möglich.' }, changed: false }; }
  }
}

function readAction(value: unknown, catalog: Catalog): GameAction {
  const invalid = (): never => { throw new Error('Ungültige Spielaktion.'); };
  if (!record(value)) return invalid();
  const cards = (data: unknown): string[] => {
    if (!Array.isArray(data) || data.length < 1 || data.length > 11 || new Set(data).size !== data.length || !data.every(id => typeof id === 'string' && catalog.has(id))) return invalid();
    return data;
  };
  if (value.kind === 'draw' && (value.source === 'stock' || value.source === 'discard')) return { kind: 'draw', source: value.source };
  if (value.kind === 'discard' && typeof value.card === 'string' && catalog.has(value.card) && (value.target === null || validId(value.target))) return { kind: 'discard', card: value.card, target: value.target };
  if (value.kind === 'lay') return { kind: 'lay', cards: cards(value.cards) };
  if (value.kind === 'hit' && validId(value.owner) && integer(value.group, 0, 1)) return { kind: 'hit', cards: cards(value.cards), owner: value.owner, group: value.group };
  if (value.kind === 'next-round') return { kind: 'next-round' };
  return invalid();
}

export function readSnapshot(value: unknown, catalog: Catalog, viewer: string): Snapshot {
  const invalid = (): never => { throw new Error('Ungültiger gemeinsamer Spielstand.'); };
  if (!record(value) || value.version !== 1 || typeof value.match !== 'string' || !/^[a-f0-9]{32}$/.test(value.match) || !integer(value.revision, 0) || value.viewer !== viewer || !validId(viewer) || !record(value.state)) return invalid();
  const state = value.state;
  if ('stock' in state || state.version !== 3 || !integer(state.round, 1) || !integer(state.turn, 1) || !integer(state.currentPlayer, 0, 1) || !['playing', 'round-over', 'finished'].includes(String(state.status)) || !['draw', 'discard'].includes(String(state.stage)) || typeof state.tieBreak !== 'boolean' || !integer(state.stockCount, 0, 108) || !record(state.handCounts) || !Array.isArray(state.players) || state.players.length !== 2 || !Array.isArray(state.discard) || !Array.isArray(state.history) || state.history.length > 6 || !state.history.every(entry => typeof entry === 'string' && entry.length <= 250)) return invalid();
  const owned: string[] = [];
  function cardIds(data: unknown, maximum = 108): asserts data is string[] {
    if (!Array.isArray(data) || data.length > maximum || !data.every(id => typeof id === 'string' && catalog.has(id))) invalid();
  }
  cardIds(state.discard); owned.push(...state.discard);
  let count = state.stockCount + state.discard.length;
  for (const [index, player] of state.players.entries()) {
    if (!record(player) || player.id !== ids[index] || typeof player.name !== 'string' || player.name.length < 1 || player.name.length > 40 || player.controller !== 'human' || player.botDifficulty !== null || !integer(player.phase, 1, 10) || !integer(player.score, 0, 1000000000) || typeof player.skipPending !== 'boolean' || typeof player.skipProtected !== 'boolean' || (player.skipPending && player.skipProtected) || !Array.isArray(player.melds) || !integer(state.handCounts[player.id as string], 0, 11)) return invalid();
    const handCount = state.handCounts[player.id as string] as number;
    const maximum = index === state.currentPlayer && state.stage === 'discard' ? 11 : 10;
    if ((!player.melds.length && handCount !== maximum) || handCount > maximum || (index === state.currentPlayer && player.skipPending)) return invalid();
    cardIds(player.hand, 11);
    if (player.hand.length !== (player.id === viewer ? handCount : 0)) return invalid();
    owned.push(...player.hand); count += handCount;
    const requirements = PHASE_GROUPS[player.phase - 1]!;
    if (player.melds.length && player.melds.length !== requirements.length) return invalid();
    player.melds.forEach((meld: unknown, group: number) => {
      assertMeld(meld, catalog);
      if (meld.kind !== requirements[group]!.kind || meld.cards.length < requirements[group]!.size) invalid();
      count += meld.cards.length; owned.push(...meld.cards);
    });
    if (player.melds.length && !player.melds.some((meld: { cards: string[] }) => meld.cards.some(id => catalog.get(id)!.type === 'number'))) return invalid();
  }
  if (count !== 108 || new Set(owned).size !== owned.length) return invalid();
  if (state.finalists !== null && (!Array.isArray(state.finalists) || state.finalists.length !== 2 || !ids.every(id => (state.finalists as unknown[]).includes(id)))) return invalid();
  if (state.tieBreak && state.finalists === null) return invalid();
  const active = state.players[state.currentPlayer];
  if (state.stage === 'draw' || active.id !== viewer) { if (state.drawnCard !== null) return invalid(); }
  else if (typeof state.drawnCard !== 'string' || ![...active.hand, ...state.players.flatMap(player => player.melds.flatMap((meld: { cards: string[] }) => meld.cards))].includes(state.drawnCard)) return invalid();
  if (state.status === 'playing') {
    if (state.roundWinner !== null || state.winner !== null || ids.some(id => (state.handCounts as Record<string, number>)[id] === 0)) return invalid();
  } else {
    const winner = state.players.find(player => player.id === state.roundWinner);
    if (!winner || !winner.melds.length || (!state.tieBreak && state.handCounts[winner.id] !== 0) || state.stage !== 'draw' || (state.status === 'finished' ? !validId(state.winner) : state.winner !== null)) return invalid();
  }
  return value as unknown as Snapshot;
}
