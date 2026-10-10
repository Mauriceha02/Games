import { createCatalog, createGame, drawCard, discardCard } from './game/game.js';
import { playBasicTurnStep } from './ai/basic-turn.js';
import { loadGame, saveGame, type StorageAccess } from './storage/local-game.js';
import { renderGameTable, type TableActions } from './ui/game-table.js';
import type { GameState } from './game/types.js';

async function start(): Promise<void> {
  const root = document.getElementById('game-root');
  const storageStatus = document.getElementById('storage-status');
  const announcement = document.getElementById('game-announcement');
  if (!root || !storageStatus || !announcement) return;
  const response = await fetch(new URL('./src/game/deck.json', document.baseURI));
  if (!response.ok) throw new Error('Das Kartendeck konnte nicht geladen werden.');
  const catalog = createCatalog(await response.json());
  const storage: StorageAccess = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  };
  const loaded = loadGame(storage, catalog);
  let state = loaded.state;
  let message = loaded.error ?? '';
  let saveError: string | null = null;
  let selected: string | null = null;
  let target: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function update(next: GameState): void {
    state = next;
    selected = null;
    target = null;
    message = '';
    saveError = saveGame(storage, state, catalog);
    announcement!.textContent = `${state.history[state.history.length - 1]} Deine Hand: ${state.players[0]!.hand.length} Karten.`;
    render();
  }

  function attempt(action: () => void): void {
    try { action(); } catch (error) {
      message = error instanceof Error ? error.message : 'Dieser Spielzug ist nicht möglich.';
      render();
    }
  }

  const actions: TableActions = {
    start: computers => attempt(() => update(createGame(catalog, computers))),
    draw: source => attempt(() => {
      if (state) update(drawCard(state, catalog, state.players[0]!.id, source));
    }),
    select: id => {
      if (!state || state.currentPlayer !== 0 || state.stage !== 'discard' || !state.players[0]!.hand.includes(id)) return;
      selected = selected === id ? null : id;
      target = null;
      message = '';
      render();
    },
    target: id => { target = id || null; render(); },
    discard: () => attempt(() => {
      if (state && selected) update(discardCard(state, catalog, state.players[0]!.id, selected, target));
    }),
  };

  function render(): void {
    if (timer !== null) clearTimeout(timer);
    renderGameTable(root!, { state, catalog, selected, target, message }, actions);
    storageStatus!.textContent = saveError ?? (state ? 'Auf diesem Gerät gespeichert.' : 'Dein Fortschritt wird auf diesem Gerät gespeichert.');
    storageStatus!.classList.toggle('storage-error', saveError !== null);
    if (state && state.players[state.currentPlayer]!.controller === 'computer' && !message) {
      timer = setTimeout(() => attempt(() => {
        if (state && state.players[state.currentPlayer]!.controller === 'computer') update(playBasicTurnStep(state, catalog));
      }), 650);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (timer !== null) clearTimeout(timer);
    } else render();
  });
  render();
}

void start().catch(() => {
  const root = document.getElementById('game-root');
  if (root) root.textContent = 'Das Spiel konnte nicht geladen werden. Bitte öffne die Seite erneut.';
});
