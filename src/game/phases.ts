import type { Card, Catalog, Color, Meld, PhaseSet } from './types.js';

// Kept in agreement with phases.json; a test checks all ten requirements.
export const PHASE_GROUPS: ReadonlyArray<ReadonlyArray<{ kind: Meld['kind']; size: number }>> = [
  [{ kind: 'set', size: 3 }, { kind: 'set', size: 3 }],
  [{ kind: 'set', size: 3 }, { kind: 'run', size: 4 }],
  [{ kind: 'set', size: 4 }, { kind: 'run', size: 4 }],
  [{ kind: 'run', size: 7 }], [{ kind: 'run', size: 8 }], [{ kind: 'run', size: 9 }],
  [{ kind: 'set', size: 4 }, { kind: 'set', size: 4 }],
  [{ kind: 'color', size: 7 }],
  [{ kind: 'set', size: 5 }, { kind: 'set', size: 2 }],
  [{ kind: 'set', size: 5 }, { kind: 'set', size: 3 }],
];

export const EXTREME_PHASE_GROUPS: typeof PHASE_GROUPS = [
  [{ kind: 'set', size: 5 }, { kind: 'set', size: 3 }],
  [{ kind: 'set', size: 5 }, { kind: 'run', size: 4 }],
  [{ kind: 'set', size: 5 }, { kind: 'run', size: 5 }],
  [{ kind: 'run', size: 9 }], [{ kind: 'run', size: 10 }],
  [{ kind: 'set', size: 4 }, { kind: 'run', size: 6 }],
  [{ kind: 'set', size: 5 }, { kind: 'set', size: 5 }],
  [{ kind: 'color', size: 9 }],
  [{ kind: 'set', size: 6 }, { kind: 'set', size: 3 }],
  [{ kind: 'set', size: 6 }, { kind: 'set', size: 4 }],
];

export const phaseSetName = (set: PhaseSet): string => set === 'extreme' ? 'Extrem' : 'Klassisch';
export const isPhaseSet = (value: unknown): value is PhaseSet => value === 'classic' || value === 'extreme';
export function phaseGroups(phase: number, set: PhaseSet = 'classic'): typeof PHASE_GROUPS[number] | undefined {
  if (!isPhaseSet(set)) throw new Error('Ungültige Phasenauswahl.');
  return (set === 'extreme' ? EXTREME_PHASE_GROUPS : PHASE_GROUPS)[phase - 1];
}

export interface PhaseDefinition { id: number; title: string; hint: string }
export type PhaseDefinitions = Record<PhaseSet, PhaseDefinition[]>;

export function readPhaseDefinitions(value: unknown, set: PhaseSet = 'classic'): PhaseDefinition[] {
  if (!Array.isArray(value) || value.length !== 10 || value.some((phase, index) =>
    !phase || phase.id !== index + 1 || typeof phase.title !== 'string' || typeof phase.hint !== 'string' ||
    !Array.isArray(phase.groups) || JSON.stringify(phase.groups.map((group: { kind: unknown; size: unknown }) =>
      ({ kind: group.kind, size: group.size }))) !== JSON.stringify(phaseGroups(index + 1, set)))) {
    throw new Error('Die Phasendefinitionen sind ungültig.');
  }
  return value.map(({ id, title, hint }) => ({ id, title, hint }));
}

function numbered(cards: Card[]): Array<Card & { type: 'number' }> {
  return cards.filter((card): card is Card & { type: 'number' } => card.type === 'number');
}

function makeGroup(ids: string[], kind: Meld['kind'], catalog: Catalog): Meld | null {
  const cards = ids.map(id => catalog.get(id)!);
  if (cards.some(card => !card || card.type === 'skip')) return null;
  const numbers = numbered(cards);
  if (kind === 'set') {
    const value = numbers[0]?.value ?? 1;
    return numbers.every(card => card.value === value) ? { kind, cards: ids, value, color: null } : null;
  }
  if (kind === 'color') {
    const color = numbers[0]?.color ?? 'red';
    return numbers.every(card => card.color === color) ? { kind, cards: ids, value: null, color } : null;
  }
  if (ids.length > 12 || new Set(numbers.map(card => card.value)).size !== numbers.length) return null;
  for (let start = 1; start <= 13 - ids.length; start++) {
    if (numbers.some(card => card.value < start || card.value >= start + ids.length)) continue;
    const wilds = cards.filter(card => card.type === 'wild').map(card => card.id);
    const ordered = Array.from({ length: ids.length }, (_, offset) =>
      numbers.find(card => card.value === start + offset)?.id ?? wilds.shift()!);
    return { kind, cards: ordered, value: start, color: null };
  }
  return null;
}

function* combinations(ids: string[], size: number, offset = 0, prefix: string[] = []): Generator<string[]> {
  if (prefix.length === size) { yield prefix; return; }
  for (let i = offset; i <= ids.length - (size - prefix.length); i++) {
    yield* combinations(ids, size, i + 1, [...prefix, ids[i]!]);
  }
}

/** Partition the entire selection; a physical card is never used in two groups. */
export function matchPhase(ids: readonly string[], phase: number, catalog: Catalog, set: PhaseSet = 'classic'): Meld[] | null {
  const requirements = phaseGroups(phase, set);
  if (!requirements || new Set(ids).size !== ids.length || ids.some(id => !catalog.has(id) || catalog.get(id)!.type === 'skip') ||
      !ids.some(id => catalog.get(id)!.type === 'number')) return null;
  function partition(remaining: string[], index: number): Meld[] | null {
    const requirement = requirements![index];
    if (!requirement) return remaining.length === 0 ? [] : null;
    const reserved = requirements!.slice(index + 1).reduce((total, group) => total + group.size, 0);
    if (remaining.length < requirement.size + reserved) return null;
    for (let size = requirement.size; size <= remaining.length - reserved; size++) {
      for (const chosen of combinations(remaining, size)) {
        const group = makeGroup(chosen, requirement.kind, catalog);
        if (!group) continue;
        const rest = partition(remaining.filter(id => !chosen.includes(id)), index + 1);
        if (rest) return [group, ...rest];
      }
    }
    return null;
  }
  return partition([...ids], 0);
}

/** Search a hand for a complete phase, preferring fewer Jokers. */
export function findPhase(hand: readonly string[], phase: number, catalog: Catalog, set: PhaseSet = 'classic'): string[] | null {
  const count = phaseGroups(phase, set)?.reduce((total, group) => total + group.size, 0);
  if (!count) return null;
  const usable = hand.filter(id => catalog.get(id)!.type !== 'skip');
  let best: string[] | null = null;
  let wildCount = Infinity;
  for (const selected of combinations(usable, count)) {
    const wilds = selected.filter(id => catalog.get(id)!.type === 'wild').length;
    if (wilds >= wildCount || !matchPhase(selected, phase, catalog, set)) continue;
    best = selected;
    wildCount = wilds;
    if (wilds === 0) break;
  }
  return best;
}

/** A Joker's original meaning stays fixed while extending a run. */
export function extendMeld(meld: Meld, ids: readonly string[], catalog: Catalog): Meld | null {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !catalog.has(id) || meld.cards.includes(id) || catalog.get(id)!.type === 'skip')) return null;
  if (meld.kind !== 'run') {
    if (ids.some(id => {
      const card = catalog.get(id)!;
      return card.type === 'number' && (meld.kind === 'set' ? card.value !== meld.value : card.color !== meld.color);
    })) return null;
    return { ...meld, cards: [...meld.cards, ...ids] };
  }
  const start = meld.value!;
  const end = start + meld.cards.length - 1;
  const cards = ids.map(id => catalog.get(id)!);
  const numbers = numbered(cards);
  if (new Set(numbers.map(card => card.value)).size !== numbers.length || numbers.some(card => card.value >= start && card.value <= end)) return null;
  for (let newStart = Math.max(1, start - ids.length); newStart <= start; newStart++) {
    const newEnd = end + ids.length - (start - newStart);
    if (newEnd > 12 || numbers.some(card => card.value < newStart || card.value > newEnd)) continue;
    const wilds = cards.filter(card => card.type === 'wild').map(card => card.id);
    const ordered: string[] = [];
    for (let value = newStart; value <= newEnd; value++) {
      ordered.push(value >= start && value <= end ? meld.cards[value - start]! :
        numbers.find(card => card.value === value)?.id ?? wilds.shift()!);
    }
    return { ...meld, value: newStart, cards: ordered };
  }
  return null;
}

export function assertMeld(value: unknown, catalog: Catalog): asserts value is Meld {
  if (!value || typeof value !== 'object') throw new Error('Ungültige ausgelegte Gruppe.');
  const meld = value as Meld;
  if (!Array.isArray(meld.cards) || !meld.cards.length || meld.cards.some(id => !catalog.has(id) || catalog.get(id)!.type === 'skip') ||
      new Set(meld.cards).size !== meld.cards.length) throw new Error('Ungültige ausgelegte Karten.');
  const cards = meld.cards.map(id => catalog.get(id)!);
  if (meld.kind === 'set') {
    if (!Number.isInteger(meld.value) || meld.value! < 1 || meld.value! > 12 || meld.color !== null ||
        numbered(cards).some(card => card.value !== meld.value)) throw new Error('Ungültige gleiche Zahlen.');
  } else if (meld.kind === 'color') {
    if (!(['red', 'blue', 'green', 'yellow'] as Color[]).includes(meld.color!) || meld.value !== null ||
        numbered(cards).some(card => card.color !== meld.color)) throw new Error('Ungültige Farbgruppe.');
  } else if (meld.kind === 'run') {
    if (!Number.isInteger(meld.value) || meld.value! < 1 || meld.value! + cards.length - 1 > 12 || meld.color !== null ||
        cards.some((card, index) => card.type === 'number' && card.value !== meld.value! + index)) throw new Error('Ungültige Folge.');
  } else throw new Error('Ungültige Gruppenart.');
}
