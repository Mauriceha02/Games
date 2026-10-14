import { assertGameState } from '../game/game.js';
import { createPhaseOrder, isBasePhaseSet } from '../game/phases.js';
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
    if (raw.length > 64 * 1024) throw new Error('Spielstand zu groß.');
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
    if (state && typeof state === 'object' && 'version' in state && state.version === 3) {
      state = { ...state, version: 4, phaseSet: 'classic' };
    }
    if (state && typeof state === 'object' && 'version' in state && state.version === 4) {
      const legacy = state as Record<string, unknown>;
      if (!isBasePhaseSet(legacy.phaseSet)) throw new Error('Ungültiger alter Phasenmodus.');
      state = { ...legacy, version: 5, phaseOrder: createPhaseOrder(legacy.phaseSet) };
    }
    assertGameState(state, catalog);
    if (state.players.filter(player => player.controller === 'human').length !== 1) throw new Error('Ungültiger Solo-Spielstand.');
    return { state, error: null };
  } catch {
    return { state: null, error: 'Der gespeicherte Spielstand konnte nicht geladen werden. Du kannst eine neue Partie starten.' };
  }
}

export function saveGame(storage: StorageAccess, state: GameState, catalog: Catalog): string | null {
  assertGameState(state, catalog);
  if (state.players.filter(player => player.controller === 'human').length !== 1) throw new Error('Eine gemeinsame Partie gehört nicht in den Solo-Spielstand.');
  try {
    const raw = JSON.stringify(state);
    if (raw.length > 64 * 1024) throw new Error('Spielstand zu groß.');
    storage.setItem(STORAGE_KEY, raw);
    return null;
  } catch {
    return 'Speichern ist gerade nicht möglich. Der aktuelle Fortschritt könnte beim Schließen verloren gehen.';
  }
}
