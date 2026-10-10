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
    const state: unknown = JSON.parse(raw);
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
