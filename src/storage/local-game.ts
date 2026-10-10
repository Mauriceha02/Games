import { assertGameState } from '../game/game.js';
import type { Catalog, GameState } from '../game/types.js';

export const STORAGE_KEY = 'phase10.game.v1';
export interface StorageAccess {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadGame(storage: StorageAccess, catalog: Catalog): { state: GameState | null; error: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { state: null, error: null };
    let state: unknown = JSON.parse(raw);
    // Keep the existing key and hand order when upgrading the first playable version.
    if (state && typeof state === 'object' && 'version' in state && state.version === 1) {
      const legacy = state as Record<string, unknown>;
      if (!Array.isArray(legacy.players)) throw new Error('Ungültiger alter Spielstand.');
      state = { ...legacy, version: 2, status: 'playing', roundWinner: null, winner: null, tieBreak: false, finalists: null,
        players: legacy.players.map(player => ({ ...player, phase: 1, score: 0, melds: [] })) };
    }
    if (state && typeof state === 'object' && 'version' in state && state.version === 2) {
      const legacy = state as Record<string, unknown>;
      if (!Array.isArray(legacy.players)) throw new Error('Ungültiger alter Spielstand.');
      state = { ...legacy, version: 3, players: legacy.players.map(player => ({ ...player,
        botDifficulty: player.controller === 'human' ? null : 'easy' })) };
    }
    assertGameState(state, catalog);
    return { state, error: null };
  } catch {
    return { state: null, error: 'Der gespeicherte Spielstand konnte nicht geladen werden. Du kannst eine neue Partie starten.' };
  }
}

export function saveGame(storage: StorageAccess, state: GameState, catalog: Catalog): string | null {
  assertGameState(state, catalog);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch {
    return 'Speichern ist gerade nicht möglich. Der aktuelle Fortschritt könnte beim Schließen verloren gehen.';
  }
}
