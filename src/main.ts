import { createCatalog, createGame, drawCard, discardCard, layPhase, hitMeld, nextRound, reorderHand, sortHand, setBotDifficulty } from './game/game.js';
import { readPhaseDefinitions } from './game/phases.js';
import { playBasicTurnStep } from './ai/basic-turn.js';
import { loadGame, saveGame, type StorageAccess } from './storage/local-game.js';
import { renderGameTable, type TableActions } from './ui/game-table.js';
import type { GameState } from './game/types.js';
import { setupOfflineApp } from './ui/offline-app.js';

setupOfflineApp();

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
  const view = (): 'home' | 'game' | 'reference' => {
    const hash = window.location.hash;
    if (hash === '#game') return 'game';
    return /^#(?:overview|deck|cards|phase-(?:[1-9]|10))$/.test(hash) ? 'reference' : 'home';
  };
  let dragging = false;
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
    start: (computers, difficulty) => attempt(() => { ordering = false; focusedCard = null; window.location.hash = 'game'; update(createGame(catalog, computers, Math.random, difficulty)); }),
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
    dragging: active => { dragging = active; scheduleBotTurn(); },
    move: (id, position) => attempt(() => move(id, position)),
    orderStep: direction => attempt(() => {
      if (state && focusedCard) move(focusedCard, state.players[0]!.hand.indexOf(focusedCard) + direction);
    }),
    sort: by => attempt(() => {
      if (state) { focusedCard = null; update(sortHand(state, catalog, state.players[0]!.id, by), true); }
    }),
  };

  function render(): void {
    const currentView = view();
    document.body.classList.toggle('is-home', currentView === 'home');
    document.body.classList.toggle('is-game', currentView === 'game');
    document.body.classList.toggle('is-playing', state !== null && currentView === 'game');
    document.body.classList.toggle('is-reference', currentView === 'reference');
    document.querySelectorAll<HTMLElement>('[data-phase-nav]').forEach(link => { link.hidden = currentView === 'home'; });
    document.title = currentView === 'home' ? 'Spiele' : 'Phase10';
    const gameLink = document.getElementById('phase10-link');
    if (gameLink) gameLink.textContent = state && state.status !== 'finished' ? 'Fortsetzen →' : 'Spielen →';
    const savedGame = document.getElementById('saved-game');
    if (savedGame) {
      savedGame.hidden = !state || state.status === 'finished';
      savedGame.textContent = state ? `Runde ${state.round} · Phase ${state.players[0]!.phase}` : '';
    }
    const appTools = document.querySelector('.app-tools');
    if (appTools) {
      if (currentView === 'home') document.getElementById('home-tools')?.append(appTools);
      else storageStatus!.after(appTools);
    }
    renderGameTable(root!, { state, catalog, phases, selected, target, message, ordering, focusedCard }, actions);
    storageStatus!.textContent = saveError ?? (state ? 'Auf diesem Gerät gespeichert.' : 'Dein Fortschritt wird auf diesem Gerät gespeichert.');
    storageStatus!.classList.toggle('storage-error', saveError !== null);
    scheduleBotTurn();
  }

  function scheduleBotTurn(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (view() === 'game' && !dragging && !document.hidden && state?.status === 'playing' && state.players[state.currentPlayer]!.controller === 'computer' && !message) {
      timer = setTimeout(() => attempt(() => {
        if (view() === 'game' && state?.status === 'playing' && state.players[state.currentPlayer]!.controller === 'computer') update(playBasicTurnStep(state, catalog));
      }), 650);
    }
  }

  window.addEventListener('hashchange', () => {
    render();
  });

  document.addEventListener('click', event => {
    if (!(event.target instanceof Node)) return;
    root!.querySelectorAll<HTMLDetailsElement>('details[data-panel][open]').forEach(panel => {
      if (!panel.contains(event.target as Node)) panel.open = false;
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    root!.querySelectorAll<HTMLDetailsElement>('details[data-panel][open]').forEach(panel => {
      panel.open = false;
      panel.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (timer !== null) clearTimeout(timer); } else render();
  });
  render();
}

void start().catch(() => {
  const home = document.getElementById('home-tools');
  if (home) {
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.textContent = 'Phase10 konnte nicht geladen werden. Bitte öffne die Seite erneut.';
    home.append(error);
  }
  const root = document.getElementById('game-root');
  if (root) root.textContent = 'Das Spiel konnte nicht geladen werden. Bitte öffne die Seite erneut.';
});
