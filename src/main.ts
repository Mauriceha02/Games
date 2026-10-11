import { createCatalog, createGame, drawCard, discardCard, layPhase, hitMeld, nextRound, reorderHand, sortHand, setBotDifficulty } from './game/game.js';
import { readPhaseDefinitions, phaseSetName } from './game/phases.js';
import { playBasicTurnStep } from './ai/basic-turn.js';
import { loadGame, saveGame, type StorageAccess } from './storage/local-game.js';
import { renderGameTable, type TableActions } from './ui/game-table.js';
import type { GameState } from './game/types.js';
import { setupOfflineApp } from './ui/offline-app.js';
import { loadGruselino } from './ui/gruselino.js';
import { mountLocalPhase10 } from './ui/local-phase10.js';
import { wireHand } from './ui/hand-drag.js';

setupOfflineApp();

async function start(): Promise<void> {
  const root = document.getElementById('game-root');
  const storageStatus = document.getElementById('storage-status');
  const announcement = document.getElementById('game-announcement');
  if (!root || !storageStatus || !announcement) return;
  const responses = await Promise.all(['deck', 'phases', 'phases-extreme'].map(name => fetch(new URL(`./src/game/${name}.json`, document.baseURI))));
  if (responses.some(response => !response.ok)) throw new Error('Die Spielkarten konnten nicht geladen werden.');
  const [cards, definitions, extreme] = await Promise.all(responses.map(response => response.json()));
  const catalog = createCatalog(cards);
  const phases = { classic: readPhaseDefinitions(definitions), extreme: readPhaseDefinitions(extreme, 'extreme') };
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
  let gruselino: { dispose(): void } | null = null;
  let mountingGruselino = false;
  let gruselinoGeneration = 0;
  let localMode = false;
  let localPlaying = false;
  let localGeneration = 0;
  let localLoading = new AbortController();
  let local: { dispose(): void; invitation(code: string): void } | null = null;
  const view = (): 'home' | 'game' | 'gruselino' | 'reference' => {
    const hash = window.location.hash;
    if (hash === '#game' || hash.startsWith('#game?invite=')) return 'game';
    if (hash === '#gruselino' || hash.startsWith('#gruselino?invite=')) return 'gruselino';
    return /^#(?:overview(?:-extreme)?|deck|cards(?:-extreme)?|phase-(?:extreme-)?(?:[1-9]|10))$/.test(hash) ? 'reference' : 'home';
  };
  let dragging = false;
  let focusedCard: string | null = null;
  let target: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stopLocal(): void {
    localGeneration++; localLoading.abort(); local?.dispose(); local = null;
    localMode = false; localPlaying = false;
  }
  async function multiplayer(invite?: string): Promise<void> {
    if (localMode && local) { if (invite) local.invitation(invite); return; }
    if (timer !== null) clearTimeout(timer);
    stopLocal(); localMode = true; dragging = false;
    const generation = ++localGeneration;
    localLoading = new AbortController();
    wireHand(root!, false, { select: () => {}, move: () => {}, dragging: () => {} });
    delete root!.dataset.status; delete root!.dataset.stage; delete root!.dataset.player;
    root!.textContent = 'Mehrspielermodus wird geladen.';
    window.location.hash = 'game'; render();
    try {
      const instance = await mountLocalPhase10(root!, {
        catalog, phases, phaseSet: state?.phaseSet ?? 'classic', signal: localLoading.signal, ...(invite ? { invite } : {}),
        onBack: () => { stopLocal(); render(); },
        onPlaying: value => { if (generation !== localGeneration) return; localPlaying = value; document.body.classList.toggle('is-playing', localMode && value && view() === 'game'); },
      });
      if (generation !== localGeneration || view() !== 'game') { instance.dispose(); return; }
      local = instance;
    } catch {
      if (generation === localGeneration) { stopLocal(); message = 'Mehrspielermodus konnte nicht geladen werden. Bitte öffne die App erneut.'; render(); }
    }
  }
  function receiveInvitation(): boolean {
    if (!location.hash.startsWith('#game?invite=')) return false;
    const invite = new URLSearchParams(location.hash.slice(6)).get('invite');
    history.replaceState(null, '', location.pathname + location.search + '#game');
    if (invite) void multiplayer(invite);
    return !!invite;
  }

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
    multiplayer: () => { void multiplayer(); },
    start: (computers, difficulty, phaseSet) => attempt(() => { ordering = false; focusedCard = null; window.location.hash = 'game'; update(createGame(catalog, computers, Math.random, difficulty, phaseSet)); }),
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
    if (currentView === 'reference' && location.hash !== '#deck') showPhaseReference(location.hash.includes('extreme') ? 'extreme' : 'classic');
    if (currentView !== 'game' && localMode) stopLocal();
    document.body.classList.toggle('is-home', currentView === 'home');
    document.body.classList.toggle('is-game', currentView === 'game');
    document.body.classList.toggle('is-gruselino', currentView === 'gruselino');
    document.body.classList.toggle('is-playing', currentView === 'game' && (localMode ? localPlaying : state !== null));
    document.body.classList.toggle('is-reference', currentView === 'reference');
    document.querySelectorAll<HTMLElement>('[data-phase-nav]').forEach(link => { link.hidden = currentView === 'home' || currentView === 'gruselino'; });
    document.title = currentView === 'home' ? 'Spiele' : currentView === 'gruselino' ? 'Gruselino' : 'Phase10';
    if (currentView !== 'gruselino') {
      gruselinoGeneration++; mountingGruselino = false;
      gruselino?.dispose(); gruselino = null;
    } else if (!gruselino && !mountingGruselino) {
      mountingGruselino = true;
      const generation = ++gruselinoGeneration;
      const gameRoot = document.getElementById('gruselino-root');
      if (gameRoot) gameRoot.textContent = 'Gruselino wird geladen.';
      void loadGruselino().then(module => {
        if (!gameRoot || generation !== gruselinoGeneration || view() !== 'gruselino') return;
        gruselino = module.mountGruselino(gameRoot, { onHome: () => { window.location.hash = 'home'; } });
        mountingGruselino = false;
      }).catch(() => {
        if (generation !== gruselinoGeneration || view() !== 'gruselino') return;
        mountingGruselino = false;
        if (gameRoot) gameRoot.textContent = 'Gruselino konnte nicht geladen werden. Bitte öffne die App erneut.';
      });
    }
    if (currentView === 'home') void loadGruselino().then(module => {
      if (view() !== 'home') return;
      const summary = module.getSavedSummary();
      const link = document.getElementById('gruselino-link');
      const saved = document.getElementById('gruselino-saved');
      if (link) link.textContent = summary && !summary.finished ? 'Fortsetzen →' : 'Spielen →';
      if (saved) {
        saved.hidden = !summary || summary.finished;
        saved.textContent = summary ? `Karte ${summary.card} von ${summary.total} · ${summary.score} ${summary.score === 1 ? 'Punkt' : 'Punkte'}` : '';
      }
    }).catch(() => {
      const saved = document.getElementById('gruselino-saved');
      if (saved) { saved.hidden = false; saved.textContent = 'Gruselino konnte nicht geladen werden. Bitte erneut öffnen.'; }
    });
    const gameLink = document.getElementById('phase10-link');
    if (gameLink) gameLink.textContent = state && state.status !== 'finished' ? 'Fortsetzen →' : 'Spielen →';
    const savedGame = document.getElementById('saved-game');
    if (savedGame) {
      savedGame.hidden = !state || state.status === 'finished';
      savedGame.textContent = state ? `${phaseSetName(state.phaseSet)} · Runde ${state.round} · Phase ${state.players[0]!.phase}` : '';
    }
    const appTools = document.querySelector('.app-tools');
    if (appTools) {
      if (currentView === 'home') document.getElementById('home-tools')?.append(appTools);
      else if (currentView === 'gruselino') document.getElementById('gruselino-tools')?.append(appTools);
      else storageStatus!.after(appTools);
    }
    if (!localMode) renderGameTable(root!, { state, catalog, phases, selected, target, message, ordering, focusedCard }, actions);
    storageStatus!.textContent = localMode ? 'Gemeinsame Partie · beide Geräte geöffnet lassen. Dein Solospielstand bleibt erhalten.' : saveError ?? (state ? 'Auf diesem Gerät gespeichert.' : 'Dein Fortschritt wird auf diesem Gerät gespeichert.');
    storageStatus!.classList.toggle('storage-error', !localMode && saveError !== null);
    scheduleBotTurn();
  }

  function scheduleBotTurn(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (view() === 'game' && !localMode && !dragging && !document.hidden && state?.status === 'playing' && state.players[state.currentPlayer]!.controller === 'computer' && !message) {
      timer = setTimeout(() => attempt(() => {
        if (view() === 'game' && !localMode && state?.status === 'playing' && state.players[state.currentPlayer]!.controller === 'computer') update(playBasicTurnStep(state, catalog));
      }), 650);
    }
  }

  window.addEventListener('hashchange', () => {
    if (!receiveInvitation()) render();
  });

  function showPhaseReference(set: string): void {
    document.querySelectorAll<HTMLElement>('[data-phase-reference]').forEach(section => { section.hidden = section.dataset.phaseReference !== set; });
    const select = document.getElementById('reference-phase-set') as HTMLSelectElement | null;
    if (select) select.value = set;
  }
  document.getElementById('reference-phase-set')?.addEventListener('change', event => {
    const set = (event.currentTarget as HTMLSelectElement).value;
    window.location.hash = set === 'extreme' ? 'overview-extreme' : 'overview';
    showPhaseReference(set);
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
  if (!receiveInvitation()) render();
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
