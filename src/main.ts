import { createCatalog, createGame, drawCard, discardCard, layPhase, hitMeld, nextRound, reorderHand, sortHand, setBotDifficulty } from './game/game.js';
import { readPhaseDefinitions } from './game/phases.js';
import { playBasicTurnStep } from './ai/basic-turn.js';
import { loadGame, saveGame, type StorageAccess } from './storage/local-game.js';
import { renderGameTable, type TableActions } from './ui/game-table.js';
import type { GameState } from './game/types.js';

async function start(): Promise<void> {
  const root = document.getElementById('game-root');
  const storageStatus = document.getElementById('storage-status');
  const announcement = document.getElementById('game-announcement');
  if (!root || !storageStatus || !announcement) return;
  const responses = await Promise.all(['deck', 'phases'].map(name => fetch(new URL(`./src/game/${name}.json`, document.baseURI))));
  if (responses.some(response => !response.ok)) throw new Error('Die Spielkarten konnten nicht geladen werden.');
  const [cards, definitions] = await Promise.all(responses.map(response => response.json()));
  const catalog = createCatalog(cards);
  const phases = readPhaseDefinitions(definitions);
  const storage: StorageAccess = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  };
  const loaded = loadGame(storage, catalog);
  let state = loaded.state;
  let message = loaded.error ?? '';
  let saveError: string | null = null;
  let selected: string[] = [];
  let ordering = false;
  let focusedCard: string | null = null;
  let target: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function update(next: GameState, keepSelection = false): void {
    state = next;
    if (!keepSelection) { selected = []; target = null; }
    if (focusedCard && !state.players[0]!.hand.includes(focusedCard)) focusedCard = null;
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

  function move(id: string, position: number): void {
    if (!state || !ordering) return;
    const hand = [...state.players[0]!.hand];
    const current = hand.indexOf(id);
    if (current < 0 || position < 0 || position >= hand.length) return;
    hand.splice(current, 1);
    hand.splice(position, 0, id);
    focusedCard = id;
    update(reorderHand(state, catalog, state.players[0]!.id, hand), true);
    announcement!.textContent = `${id && catalog.get(id)?.type === 'number' ? 'Karte' : 'Sonderkarte'} an Position ${position + 1} verschoben.`;
  }

  const actions: TableActions = {
    start: (computers, difficulty) => attempt(() => { ordering = false; focusedCard = null; update(createGame(catalog, computers, Math.random, difficulty)); }),
    difficulty: level => attempt(() => {
      if (state) { update(setBotDifficulty(state, catalog, level), true); announcement!.textContent = 'Die Spielstärke der Computer wurde geändert.'; }
    }),
    nextRound: () => attempt(() => { if (state) { ordering = false; update(nextRound(state, catalog)); } }),
    draw: source => attempt(() => {
      if (state) { ordering = false; update(drawCard(state, catalog, state.players[0]!.id, source)); }
    }),
    select: id => {
      if (!state || !state.players[0]!.hand.includes(id)) return;
      if (ordering) focusedCard = focusedCard === id ? null : id;
      else {
        if (state.status !== 'playing' || state.currentPlayer !== 0 || state.stage !== 'discard') return;
        selected = selected.includes(id) ? selected.filter(card => card !== id) : [...selected, id];
        target = null;
      }
      message = '';
      render();
    },
    clear: () => { selected = []; target = null; render(); },
    target: id => { target = id || null; render(); },
    discard: () => attempt(() => {
      if (state && selected.length === 1) update(discardCard(state, catalog, state.players[0]!.id, selected[0]!, target));
    }),
    lay: () => attempt(() => { if (state) update(layPhase(state, catalog, state.players[0]!.id, selected)); }),
    hit: (owner, group) => attempt(() => { if (state) update(hitMeld(state, catalog, state.players[0]!.id, selected, owner, group)); }),
    orderMode: () => { ordering = !ordering; focusedCard = null; message = ''; render(); },
    move: (id, position) => attempt(() => move(id, position)),
    orderStep: direction => attempt(() => {
      if (state && focusedCard) move(focusedCard, state.players[0]!.hand.indexOf(focusedCard) + direction);
    }),
    sort: by => attempt(() => {
      if (state) { focusedCard = null; update(sortHand(state, catalog, state.players[0]!.id, by), true); }
    }),
  };

  function render(): void {
    if (timer !== null) clearTimeout(timer);
    renderGameTable(root!, { state, catalog, phases, selected, target, message, ordering, focusedCard }, actions);
    storageStatus!.textContent = saveError ?? (state ? 'Auf diesem Gerät gespeichert.' : 'Dein Fortschritt wird auf diesem Gerät gespeichert.');
    storageStatus!.classList.toggle('storage-error', saveError !== null);
    if (!document.hidden && state?.status === 'playing' && state.players[state.currentPlayer]!.controller === 'computer' && !message) {
      timer = setTimeout(() => attempt(() => {
        if (state?.status === 'playing' && state.players[state.currentPlayer]!.controller === 'computer') update(playBasicTurnStep(state, catalog));
      }), 650);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (timer !== null) clearTimeout(timer); } else render();
  });
  render();
}

void start().catch(() => {
  const root = document.getElementById('game-root');
  if (root) root.textContent = 'Das Spiel konnte nicht geladen werden. Bitte öffne die Seite erneut.';
});
