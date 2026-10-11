import { extendMeld, findPhase, phaseGroups } from '../game/phases.js';
import type { BotDifficulty, Card, Catalog, GameState, Meld, PhaseSet } from '../game/types.js';

interface PublicPlayer {
  id: string;
  phase: number;
  score: number;
  handCount: number;
  melds: Meld[];
  skipPending: boolean;
  skipProtected: boolean;
}

/** Decisions receive only the bot's own hand and information visible at the table. */
export interface BotView {
  id: string;
  difficulty: BotDifficulty;
  phase: number;
  phaseSet: PhaseSet;
  hand: string[];
  melds: Meld[];
  stage: 'draw' | 'discard';
  opponents: PublicPlayer[]; // Clockwise, next player first. No hidden card IDs.
  table: Array<{ owner: string; group: number; meld: Meld }>;
  topDiscard: string | null;
  canDrawStock: boolean;
}

export type BotMove =
  | { kind: 'draw'; source: 'stock' | 'discard' }
  | { kind: 'lay'; cards: string[] }
  | { kind: 'hit'; cards: string[]; owner: string; group: number }
  | { kind: 'discard'; card: string; target: string | null };

export function createBotView(state: GameState): BotView {
  const player = state.players[state.currentPlayer]!;
  if (state.status !== 'playing' || player.controller !== 'computer' || !player.botDifficulty) throw new Error('Der menschliche Spieler entscheidet selbst oder die Runde ist beendet.');
  const melds = (groups: Meld[]): Meld[] => groups.map(meld => ({ ...meld, cards: [...meld.cards] }));
  const opponents = Array.from({ length: state.players.length - 1 }, (_, offset) => {
    const other = state.players[(state.currentPlayer + offset + 1) % state.players.length]!;
    return { id: other.id, phase: other.phase, score: other.score, handCount: other.hand.length,
      melds: melds(other.melds), skipPending: other.skipPending, skipProtected: other.skipProtected };
  }).filter(other => !state.finalists || state.finalists.includes(other.id));
  return {
    id: player.id, difficulty: player.botDifficulty, phase: player.phase, phaseSet: state.phaseSet, hand: [...player.hand], melds: melds(player.melds),
    stage: state.stage, opponents, topDiscard: state.discard[state.discard.length - 1] ?? null,
    canDrawStock: state.stock.length > 0 || state.discard.length > 1,
    table: [player, ...opponents].flatMap(other => other.melds.map((meld, group) => ({ owner: other.id, group, meld: { ...meld, cards: [...meld.cards] } }))),
  };
}

function targetForSkip(view: BotView): string | null {
  const eligible = view.opponents.filter(player => !player.skipPending && !player.skipProtected);
  if (view.difficulty === 'easy') return eligible[0]?.id ?? null;
  const threat = (player: PublicPlayer): number => (player.melds.length ? 200 : 0) + (10 - player.handCount) * 15 + player.phase * 4;
  return [...eligible].sort((a, b) => threat(b) - threat(a) || a.score - b.score)[0]?.id ?? null;
}

function canEndTurn(hand: readonly string[], target: string | null, catalog: Catalog): boolean {
  return hand.length === 0 || hand.some(id => catalog.get(id)!.type !== 'skip') || target !== null;
}

/** Maximum phase slots that can be filled, with no card or Joker counted twice. */
export function phaseProgress(hand: readonly string[], phase: number, catalog: Catalog, set: PhaseSet = 'classic'): number {
  const groups = phaseGroups(phase, set);
  if (!groups) throw new Error('Ungültige Phase.');
  const counts = Array<number>(13).fill(0);
  const colors = new Map<string, number>();
  let wilds = 0;
  for (const id of hand) {
    const card = catalog.get(id)!;
    if (card.type === 'wild') wilds++;
    else if (card.type === 'number') { counts[card.value] = counts[card.value]! + 1; colors.set(card.color, (colors.get(card.color) ?? 0) + 1); }
  }
  const best = (group: { kind: Meld['kind']; size: number }, values: number[], jokers: number): number => {
    let natural = 0;
    if (group.kind === 'set') natural = Math.max(...values);
    else if (group.kind === 'color') natural = Math.max(0, ...colors.values());
    else {
      for (let start = 1; start <= 13 - group.size; start++) {
        let inWindow = 0;
        for (let value = start; value < start + group.size; value++) if (values[value]) inWindow++;
        natural = Math.max(natural, inWindow);
      }
    }
    return Math.min(group.size, natural + jokers);
  };
  let progress = 0;
  if (groups.length === 1) progress = best(groups[0]!, counts, wilds);
  else {
    // Both phase sets start two-part tasks with a set. Enumerate how many natural
    // cards and Jokers belong to that set, leaving the remainder for part two.
    const first = groups[0]!, second = groups[1]!;
    for (let value = 1; value <= 12; value++) {
      for (let natural = 0; natural <= Math.min(first.size, counts[value]!); natural++) {
        const remaining = [...counts]; remaining[value] = remaining[value]! - natural;
        for (let jokers = 0; jokers <= Math.min(wilds, first.size - natural); jokers++) {
          progress = Math.max(progress, natural + jokers + best(second, remaining, wilds - jokers));
        }
      }
    }
  }
  const required = groups.reduce((sum, group) => sum + group.size, 0);
  return counts.some(count => count > 0) ? progress : Math.min(progress, required - 1);
}

function localUsefulness(id: string, hand: readonly string[], phase: number, catalog: Catalog, set: PhaseSet = 'classic'): number {
  const card = catalog.get(id)!;
  if (card.type !== 'number') return card.type === 'wild' ? 100 : 0;
  const kinds = phaseGroups(phase, set)!.map(group => group.kind);
  let value = 0;
  for (const otherId of hand) {
    if (otherId === id) continue;
    const other = catalog.get(otherId)!;
    if (other.type !== 'number') continue;
    if (kinds.includes('set') && card.value === other.value) value += 4;
    if (kinds.includes('color') && card.color === other.color) value += 3;
    if (kinds.includes('run') && Math.abs(card.value - other.value) === 1) value += 2;
  }
  return value;
}

function* selections(hand: readonly string[]): Generator<string[]> {
  for (let mask = 1; mask < 1 << hand.length; mask++) yield hand.filter((_, index) => mask & 1 << index);
}

function chooseHit(view: BotView, catalog: Catalog, target: string | null): BotMove | null {
  const playable = view.hand.filter(id => catalog.get(id)!.type !== 'skip');
  const candidates = view.difficulty === 'strong' ? [...selections(playable)] : [
    ...playable.filter(id => catalog.get(id)!.type === 'number').map(id => [id]),
    ...playable.filter(id => catalog.get(id)!.type === 'wild').flatMap(wild => playable.filter(id => catalog.get(id)!.type === 'number').map(id => [wild, id])),
    ...playable.filter(id => catalog.get(id)!.type === 'wild').map(id => [id]),
  ];
  let chosen: BotMove | null = null;
  let highest = -Infinity;
  for (const selected of candidates) {
    if (!canEndTurn(view.hand.filter(id => !selected.includes(id)), target, catalog)) continue;
    for (const group of view.table) {
      if (!extendMeld(group.meld, selected, catalog)) continue;
      const wilds = selected.filter(id => catalog.get(id)!.type === 'wild').length;
      const score = selected.length * 100 - wilds * 5 + (group.owner === view.id ? 1 : 0);
      if (view.difficulty === 'easy') return { kind: 'hit', cards: selected, owner: group.owner, group: group.group };
      if (score > highest) { highest = score; chosen = { kind: 'hit', cards: selected, owner: group.owner, group: group.group }; }
    }
  }
  return chosen;
}

function drawSource(view: BotView, catalog: Catalog): 'stock' | 'discard' {
  const top = view.topDiscard ? catalog.get(view.topDiscard)! : null;
  if (!top || top.type === 'skip') return 'stock';
  if (!view.canDrawStock) return 'discard';
  if (top.type === 'wild') {
    const next = chooseBotMove({ ...view, stage: 'discard', hand: [...view.hand, top.id] }, catalog);
    // Do not pick up a Joker merely to throw it straight back when a stock draw
    // might provide a legal number instead (only-specials hand, blocked Skips).
    return next.kind === 'discard' && catalog.get(next.card)!.type === 'wild' ? 'stock' : 'discard';
  }
  if (view.melds.length) return view.table.some(group => extendMeld(group.meld, [top.id], catalog)) ? 'discard' : 'stock';
  const withTop = [...view.hand, top.id];
  if (findPhase(withTop, view.phase, catalog, view.phaseSet)) return 'discard';
  const useful = view.difficulty === 'strong' ? phaseProgress(withTop, view.phase, catalog, view.phaseSet) > phaseProgress(view.hand, view.phase, catalog, view.phaseSet) :
    localUsefulness(top.id, withTop, view.phase, catalog, view.phaseSet) > 0;
  return useful ? 'discard' : 'stock';
}

/** Observable help: an opponent who has laid can immediately hit any open group. */
function discardRisk(id: string, view: BotView, catalog: Catalog): number {
  if (!view.opponents.some(player => player.melds.length) || !view.table.some(group => extendMeld(group.meld, [id], catalog))) return 0;
  return view.opponents.reduce((risk, player, index) => risk + (player.melds.length ? 10 + Math.max(0, 10 - player.handCount) + (index === 0 ? 20 : 0) : 0), 0);
}

function penalty(card: Card): number {
  return card.type === 'number' ? card.value <= 9 ? 5 : 10 : card.type === 'skip' ? 15 : 25;
}

export function chooseBotMove(view: BotView, catalog: Catalog): BotMove {
  if (view.stage === 'draw') return { kind: 'draw', source: drawSource(view, catalog) };
  const target = targetForSkip(view);
  if (!view.melds.length) {
    const phase = findPhase(view.hand, view.phase, catalog, view.phaseSet);
    if (phase && canEndTurn(view.hand.filter(id => !phase.includes(id)), target, catalog)) return { kind: 'lay', cards: phase };
  } else {
    const hit = chooseHit(view, catalog, target);
    if (hit) return hit;
  }
  const skip = view.hand.find(id => catalog.get(id)!.type === 'skip');
  if (skip && target) return { kind: 'discard', card: skip, target };
  const numbers = view.hand.filter(id => catalog.get(id)!.type === 'number');
  if (numbers.length) {
    const risk = new Map(numbers.map(id => [id, discardRisk(id, view, catalog)]));
    const safe = view.difficulty === 'strong' ? numbers.filter(id => risk.get(id) === 0) : numbers;
    const options = safe.length ? safe : numbers;
    const utility = new Map(options.map(id => [id, view.melds.length ? 0 : view.difficulty === 'strong' ?
      phaseProgress(view.hand.filter(card => card !== id), view.phase, catalog, view.phaseSet) : -localUsefulness(id, view.hand, view.phase, catalog, view.phaseSet)]));
    const card = [...options].sort((a, b) => utility.get(b)! - utility.get(a)! ||
      (view.difficulty === 'strong' ? risk.get(a)! - risk.get(b)! : 0) || penalty(catalog.get(b)!) - penalty(catalog.get(a)!))[0]!;
    return { kind: 'discard', card, target: null };
  }
  // Mandatory discard: only give up a Joker if no number, legal Skip, phase or hit
  // is available. Holding it here would stall the game rather than finish a turn.
  const wild = view.hand.find(id => catalog.get(id)!.type === 'wild');
  if (wild) return { kind: 'discard', card: wild, target: null };
  throw new Error('Für diese Hand gibt es gerade keinen legalen Abwurf.');
}
