import type { Random } from './types.js';

/** Fisher–Yates: every remaining position has the same probability. */
export function shuffle<T>(cards: readonly T[], random: Random = Math.random): T[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error('Die Zufallsquelle muss einen Wert zwischen 0 und 1 liefern.');
    }
    const j = Math.floor(value * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
