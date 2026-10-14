import { wireHand, type HandActions } from './hand-drag.js';
import { describeCard, eligibleSkipTargets } from '../game/game.js';
import { extendMeld, matchPhase, phaseGroups, phaseTask, phaseSetName, type PhaseDefinitions } from '../game/phases.js';
import type { VisibleGameState } from '../game/local-match.js';
import type { Card, Catalog, GameState, Meld, BotSetup, Player, PhaseSet } from '../game/types.js';

export interface TableActions extends HandActions {
  multiplayer?(): void;
  leaveMultiplayer?(): void;
  restartMultiplayer?(): void;
  start(computers: number, difficulty: BotSetup, phaseSet: PhaseSet): void;
  difficulty(level: BotSetup): void;
  nextRound(): void;
  draw(source: 'stock' | 'discard'): void;
  clear(): void;
  target(id: string): void;
  discard(): void;
  lay(): void;
  hit(owner: string, group: number): void;
  orderMode(): void;
  orderStep(direction: number): void;
  sort(by: 'number' | 'color'): void;
}

export interface TableView {
  state: GameState | VisibleGameState | null;
  viewerId?: string;
  network?: { connected: boolean; host: boolean; pending: boolean; status: string };
  catalog: Catalog;
  phases: PhaseDefinitions;
  selected: string[];
  target: string | null;
  message: string;
  ordering: boolean;
  focusedCard: string | null;
}

const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const image = (card: Card): string => `<img src="./${escape(card.asset)}" width="240" height="336" alt="${escape(describeCard(card))}" draggable="false">`;
const colorSymbol = { red: '●', blue: '■', green: '▲', yellow: '◆' };
const cardFace = (card: Card): string => `${image(card)}<span class="hand-corner" data-color="${card.color ?? 'special'}" aria-hidden="true"><span>${card.type === 'number' ? card.value : card.type === 'wild' ? '✦' : 'Ø'}</span>${card.type === 'number' ? `<small>${colorSymbol[card.color]}</small>` : ''}</span>`;
const cardCount = (count: number): string => `${count} ${count === 1 ? 'Karte' : 'Karten'}`;
const disabled = (enabled: unknown): string => enabled ? '' : ' disabled';
const colorName = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };
const groupName = (group: Meld): string => group.kind === 'set' ? `${group.cards.length} × ${group.value}` : group.kind === 'color' ? colorName[group.color!] : `Folge ${group.value}–${group.value! + group.cards.length - 1}`;

function meldCard(card: Card, group: Meld, offset: number): string {
  if (card.type !== 'wild') return `<div class="meld-card">${cardFace(card)}</div>`;
  const value = group.kind === 'color' ? colorSymbol[group.color!] : group.kind === 'run' ? group.value! + offset : group.value;
  const label = group.kind === 'color' ? colorName[group.color!] : String(value);
  return `<div class="meld-card">${cardFace(card)}<span class="wild-value" data-color="${group.color ?? 'special'}" role="img" aria-label="Joker als ${escape(label)}">${value}</span></div>`;
}

function difficultyOptions(current: BotSetup): string {
  return ([['easy', 'Einfach'], ['strong', 'Stark'], ['mixed', 'Gemischt']] as const)
    .map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('');
}

function botSetup(state: Pick<GameState, 'players'>): BotSetup {
  const levels = state.players.filter(player => player.controller === 'computer').map(player => player.botDifficulty);
  return levels.every(level => level === levels[0]) ? levels[0]! : 'mixed';
}

export function phaseSetOptions(current: PhaseSet): string {
  return (['classic', 'extreme', 'mixed'] as const).map(set => `<option value="${set}"${current === set ? ' selected' : ''}>${phaseSetName(set)}</option>`).join('');
}

function startForm(restart: boolean, count = 2, difficulty: BotSetup = 'easy', phaseSet: PhaseSet = 'classic'): string {
  return `<form class="start-form"><div class="phase-choice"><label for="start-phase-set">Phasen</label><select id="start-phase-set" name="phaseSet">${phaseSetOptions(phaseSet)}</select><span class="variant-note">Gemischt: fünf klassische und fünf Extrem-Phasen in zufälliger Reihenfolge.</span></div><label for="computer-count">Computergegner</label><select id="computer-count" name="computers">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === count ? ' selected' : ''}>${value}</option>`).join('')}</select><label for="start-difficulty">Spielstärke</label><select id="start-difficulty" name="difficulty">${difficultyOptions(difficulty)}</select><button class="game-primary" type="submit">${restart ? 'Neu starten' : 'Partie starten'}</button>${restart ? '<p class="reset-note">Die aktuelle Partie wird ersetzt.</p>' : ''}</form>`;
}

const viewer = (view: TableView): Player => view.state!.players.find(player => player.id === view.viewerId) ?? view.state!.players[0]!;
const playerName = (view: TableView, player: Player): string => player.id === viewer(view).id ? 'Du' : player.name;
const handCount = (state: GameState | VisibleGameState, player: Player): number => 'handCounts' in state ? state.handCounts[player.id]! : player.hand.length;
const badge = (player: Player): string => player.controller === 'computer' ? `<span class="bot-badge">${player.botDifficulty === 'strong' ? 'Stark' : 'Einfach'}</span>` : '';

function tableMelds(view: TableView, canPlay: boolean): string {
  const { state, catalog, selected } = view;
  if (!state?.players.some(player => player.melds.length)) return '';
  const canHit = canPlay && viewer(view).melds.length && selected.length;
  return `<section class="laid-phases" aria-label="Ausgelegte Phasen"><h3>Auf dem Tisch</h3>${state.players.filter(player => player.melds.length).map(player => `<div class="laid-player"><h4>${escape(playerName(view, player))} · Phase ${player.phase}</h4><div class="meld-groups">${player.melds.map((group, index) => `<div class="meld-group${canHit && extendMeld(group, selected, catalog) ? ' can-hit' : ''}"><span class="meld-label">${escape(groupName(group))}</span><div class="meld-cards">${group.cards.map((id, offset) => meldCard(catalog.get(id)!, group, offset)).join('')}</div>${state.status === 'playing' && viewer(view).melds.length ? `<button class="game-secondary" type="button" data-hit-owner="${escape(player.id)}" data-hit-group="${index}" data-focus="hit-${escape(player.id)}-${index}"${disabled(canHit && extendMeld(group, selected, catalog))}>Hier anlegen</button>` : ''}</div>`).join('')}</div></div>`).join('')}</section>`;
}

function result(view: TableView): string {
  const state = view.state!;
  if (state.status === 'playing') return '';
  const roundWinner = state.players.find(player => player.id === state.roundWinner)!;
  const winner = state.players.find(player => player.id === state.winner);
  const title = winner ? `${winner.id === viewer(view).id ? 'Du gewinnst' : `${playerName(view, winner)} gewinnt`} die Partie!` : `${playerName(view, roundWinner)} beendet Runde ${state.round}.`;
  return `<section class="round-result" aria-label="Rundenergebnis"><h2>${escape(title)}</h2><p>${winner ? 'Alle zehn Phasen sind geschafft.' : state.finalists ? 'Gleichstand nach Phase 10. Die punktgleichen Spieler spielen eine Stichrunde; die erste ausgelegte Phase entscheidet.' : 'Wer seine Phase ausgelegt hat, spielt in der nächsten Runde die nächste Phase.'}</p><ul>${state.players.map(player => `<li><strong>${escape(playerName(view, player))} ${badge(player)}</strong><span>Phase ${player.phase}${player.melds.length ? ' ✓' : ''} · ${player.score} Punkte</span></li>`).join('')}</ul>${state.status === 'round-over' ? view.network && !view.network.host ? '<p>Der Gastgeber startet die nächste Runde.</p>' : `<button class="game-primary" type="button" data-action="next-round" data-focus="next-round"${disabled(!view.network || (view.network.connected && !view.network.pending))}>Nächste Runde</button>` : view.network?.host ? '<button class="game-primary" type="button" data-action="multiplayer-restart">Neue gemeinsame Partie</button>' : ''}</section>`;
}

export function renderGameTable(root: HTMLElement, view: TableView, actions: TableActions): void {
  const { state, catalog, phases, selected, target, message, ordering, focusedCard } = view;
  const tableScroll = root.querySelector<HTMLElement>('.table-scroll')?.scrollTop ?? 0;
  const openPanels = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[data-panel][open]')].map(panel => panel.dataset.panel));
  const previouslyFocused = root.contains(document.activeElement) && document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.focus ?? null : null;
  if (state === null) {
    delete root.dataset.status; delete root.dataset.stage; delete root.dataset.player;
    root.innerHTML = `<div class="game-start"><div class="start-card-art" aria-hidden="true"><img src="./public/assets/card-back.svg" width="240" height="336" alt=""><img src="./public/assets/card-green-07.svg" width="240" height="336" alt=""></div><div><h2>Neue Partie</h2><p>Du erhältst zehn Karten. Die Hände der Computergegner bleiben verdeckt.</p>${actions.multiplayer ? '<button class="game-secondary multiplayer-entry" type="button" data-action="multiplayer">Mitspieler im WLAN</button>' : ''}${startForm(false)}</div></div>${message ? `<p class="game-message" role="alert">${escape(message)}</p>` : ''}`;
  } else {
    const active = state.players[state.currentPlayer]!;
    const human = viewer(view);
    const stockCount = 'stockCount' in state ? state.stockCount : state.stock.length;
    const yourTurn = active.id === human.id && state.status === 'playing' && (!view.network || (view.network.connected && !view.network.pending));
    const canDraw = yourTurn && state.stage === 'draw';
    const canPlay = yourTurn && state.stage === 'discard' && !ordering;
    const topId = state.discard[state.discard.length - 1];
    const top = topId ? catalog.get(topId)! : null;
    const selectedCard = selected.length === 1 ? catalog.get(selected[0]!)! : null;
    const skipTargets = eligibleSkipTargets(state);
    const needsTarget = selectedCard?.type === 'skip' && !ordering;
    const task = phaseTask(human.phase, state.phaseSet, state.phaseOrder)!;
    const phase = phases[task.set][task.phase - 1]!;
    const source = `${phaseSetName(task.set)} ${task.phase}`;
    const phaseOrder = state.phaseSet === 'mixed' ? `<details class="phase-order" data-panel="phase-order"><summary>Deine Phasenfolge</summary><ol class="phase-order-list">${state.phaseOrder.map((entry, index) => `<li${index === human.phase - 1 ? ' class="is-current" aria-current="step"' : ''}><span>${escape(phases[entry.set][entry.phase - 1]!.title)}</span><small>${phaseSetName(entry.set)} ${entry.phase}${index < human.phase - 1 || (index === human.phase - 1 && human.melds.length) ? ' ✓' : ''}</small></li>`).join('')}</ol></details>` : '';
    const requiredCount = phaseGroups(human.phase, state.phaseSet, state.phaseOrder)!.reduce((total, group) => total + group.size, 0);
    const matched = canPlay && !human.melds.length && selected.length ? matchPhase(selected, human.phase, catalog, state.phaseSet, state.phaseOrder) : null;
    const position = focusedCard ? human.hand.indexOf(focusedCard) : -1;
    const spectator = state.tieBreak && !state.finalists?.includes(human.id);
    const title = spectator ? 'Die Stichrunde läuft.' : yourTurn ? 'Du bist am Zug.' : `${playerName(view, active)} ist am Zug.`;
    const instruction = ordering ? 'Hand ordnen: Karten ziehen oder Pfeile nutzen.' : yourTurn
      ? canDraw ? 'Ziehe eine Karte.' : human.melds.length ? 'Anlegen oder abwerfen.' : 'Phase auslegen oder abwerfen.'
      : state.stage === 'draw' ? 'Zieht eine Karte.' : 'Spielt und wirft ab.';
    root.dataset.stage = state.stage;
    root.dataset.player = active.id;
    root.dataset.status = state.status;
    root.innerHTML = `<div class="table-fixed-top">
<div class="game-topline"><div class="round-meta"><span class="round-label">${state.tieBreak ? 'STICHRUNDE' : 'RUNDE'} ${state.round}</span><span class="phase-set-badge" data-phase-set="${state.phaseSet}">${phaseSetName(state.phaseSet)}</span></div><details class="table-settings" data-panel="settings"><summary>Spielmenü</summary><div class="settings-content"><div class="phase-help"><img src="./public/assets/phase-${task.set === 'extreme' ? 'extreme-' : ''}${String(task.phase).padStart(2, '0')}.svg" width="240" height="336" alt="${phaseSetName(task.set)} · Phase ${task.phase}"><div><strong>${escape(phase.title)}</strong><p>${escape(phase.hint)}</p>${state.phaseSet === 'mixed' ? `<p class="phase-source">Vorlage: ${source}</p>` : ''}<p>${human.score} Punkte · ${requiredCount} Karten für die Phase</p></div></div>${phaseOrder}${view.network ? `<p class="multiplayer-note">Gemeinsame Partie · ${escape(view.network.status)}. Beide Geräte geöffnet lassen.</p><button class="game-secondary" type="button" data-action="multiplayer-leave">Zur Solopartie</button>` : `<label class="bot-setting" for="bot-difficulty">Spielstärke<select id="bot-difficulty" data-focus="bot-difficulty" data-action="difficulty">${difficultyOptions(botSetup(state))}</select></label>${actions.multiplayer ? '<button class="game-secondary multiplayer-entry" type="button" data-action="multiplayer">Mitspieler im WLAN</button>' : ''}<details class="new-game"><summary>Neue Partie</summary>${startForm(true, state.players.length - 1, botSetup(state), state.phaseSet)}</details>`}<details class="turn-history" data-panel="history"><summary>Letzte Züge</summary><ol>${state.history.map(entry => `<li>${escape(entry)}</li>`).join('')}</ol></details></div></details></div>
<div class="current-phase"><h3>Phase ${human.phase} · ${escape(phase.title)}</h3><span class="phase-progress">${spectator ? 'Stichrunde: Du schaust zu.' : human.melds.length ? `✓ Ausgelegt${human.phase < 10 ? `<span class="phase-next"> · nächste Phase ${human.phase + 1}</span>` : '<span class="phase-next"> · letzte Phase</span>'}` : `${requiredCount} Karten · ${state.phaseSet === 'mixed' ? source : `${human.score} Punkte`}`}</span></div>
${state.status === 'playing' ? `<div class="turn-heading"><h2>${escape(view.network && !view.network.connected ? 'Verbindung unterbrochen.' : view.network?.pending ? 'Zug wird übertragen …' : title)}</h2><p>${escape(instruction)}</p></div>` : ''}
<div class="piles"><div><button class="pile-card" id="draw-stock" type="button" data-action="draw-stock" data-focus="draw-stock" aria-label="Eine Karte vom Nachziehstapel ziehen"${disabled(canDraw && !ordering && (stockCount || state.discard.length > 1))}><img src="./public/assets/card-back.svg" width="240" height="336" alt="Verdeckter Nachziehstapel"><span class="pile-count">${stockCount}</span></button><span class="pile-label">Nachziehen</span></div><div><button class="pile-card" id="draw-discard" type="button" data-action="draw-discard" data-focus="draw-discard" aria-label="Die oberste Karte vom Ablagestapel aufnehmen"${disabled(canDraw && !ordering && top && top.type !== 'skip')}>${top ? image(top) : '<span class="empty-pile">Leer</span>'}<span class="pile-count">${state.discard.length}</span></button><span class="pile-label">Ablage<strong>${top ? escape(describeCard(top)) : 'Leer'}</strong></span></div></div>
${top?.type === 'skip' ? '<p class="pile-hint">Aussetzen kannst du nicht aufnehmen.</p>' : ''}
</div>
<div class="table-scroll" tabindex="0" aria-label="Spieler und ausgelegte Phasen"><div class="opponents">${state.players.filter(player => player.id !== human.id).map(player => `<div class="opponent${player.id === active.id && state.status === 'playing' ? ' is-active' : ''}"><strong>${escape(playerName(view, player))} ${badge(player)}</strong><span>${cardCount(handCount(state, player))}${player.skipPending ? ' · setzt aus' : ''}</span><span>Phase ${player.phase}${player.melds.length ? ' ✓' : ''}</span></div>`).join('')}</div>
${result(view)}
${tableMelds(view, canPlay) || (state.status === 'playing' ? '<p class="empty-table">Ausgelegte Phasen erscheinen hier.</p>' : '')}</div>
<div class="hand-panel">
<div class="hand-heading"><div><h3>Deine Hand</h3><span id="hand-count">${cardCount(human.hand.length)}</span></div><div class="hand-tools"><details class="hand-options" data-panel="sorting"><summary>Sortieren</summary><div><button class="game-secondary" type="button" data-action="sort-number" data-focus="sort-number"${disabled(human.hand.length)}>Nach Zahl</button><button class="game-secondary" type="button" data-action="sort-color" data-focus="sort-color"${disabled(human.hand.length)}>Nach Farbe</button></div></details><button class="game-secondary hand-order-button" type="button" data-action="order-mode" data-focus="order-mode" aria-pressed="${ordering}"${disabled(human.hand.length)}>${ordering ? 'Fertig' : 'Hand ordnen'}</button></div></div>
${ordering ? `<p class="ordering-hint">Karten ziehen oder mit den Pfeilen verschieben.</p>` : ''}
<div class="hand-grid${ordering ? ' is-ordering' : ''}">${human.hand.map(id => `<button class="hand-card${(ordering ? focusedCard === id : selected.includes(id)) ? ' is-selected' : ''}${state.drawnCard === id && yourTurn ? ' is-drawn' : ''}" type="button" data-card="${escape(id)}" data-focus="${escape(id)}" aria-label="${escape(describeCard(catalog.get(id)!))}${ordering ? ' zum Verschieben' : ' auswählen'}" aria-pressed="${ordering ? focusedCard === id : selected.includes(id)}"${disabled(ordering || canPlay)}>${cardFace(catalog.get(id)!)}</button>`).join('')}</div>
${ordering ? `<div class="order-controls"><button class="game-secondary" type="button" data-action="move-left" data-focus="move-left" aria-label="Gewählte Karte einen Platz nach links verschieben"${disabled(position > 0)}>← Nach links</button><span>${position >= 0 ? `Platz ${position + 1} von ${human.hand.length}` : 'Eine Karte auswählen'}</span><button class="game-secondary" type="button" data-action="move-right" data-focus="move-right" aria-label="Gewählte Karte einen Platz nach rechts verschieben"${disabled(position >= 0 && position < human.hand.length - 1)}>Nach rechts →</button></div>` : `<div class="selection-status" role="status">${selected.length ? `${selected.length} ausgewählt${matched ? ` · ${matched.map(group => escape(groupName(group))).join(' + ')} ✓` : !human.melds.length && selected.length > 1 ? ' · Phase unvollständig' : ''}` : canDraw ? 'Erst eine Karte ziehen.' : canPlay ? 'Karten auswählen.' : ''}</div><div class="discard-controls">${!human.melds.length ? `<button class="game-primary" id="lay-phase" type="button" data-action="lay-phase" data-focus="lay-phase"${disabled(matched)}>Phase ${human.phase} legen</button>` : ''}${needsTarget ? `<label class="skip-target">Wer setzt aus?<select data-action="skip-target" data-focus="skip-target" aria-label="Spieler zum Aussetzen auswählen"><option value="">Bitte wählen</option>${skipTargets.map(player => `<option value="${escape(player.id)}"${target === player.id ? ' selected' : ''}>${escape(playerName(view, player))}</option>`).join('')}</select></label>${skipTargets.length ? '' : '<p>Wähle eine andere Karte. Die anderen Spieler müssen erst wieder einen normalen Zug spielen.</p>'}` : ''}<button class="game-primary" id="discard-card" type="button" data-action="discard" data-focus="discard"${disabled(canPlay && selectedCard && (!needsTarget || skipTargets.some(player => player.id === target)))}>${selectedCard ? `${escape(describeCard(selectedCard))} abwerfen` : 'Eine Karte abwerfen'}</button>${selected.length ? '<button class="game-secondary" type="button" data-action="clear" data-focus="clear" aria-label="Auswahl aufheben">✕</button>' : ''}</div>`}
${message ? `<p class="game-message" role="alert">${escape(message)}</p>` : ''}
</div>`;
  }

  root.querySelector<HTMLFormElement>('.start-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    actions.start(Number(data.get('computers')), String(data.get('difficulty')) as BotSetup, String(data.get('phaseSet')) as PhaseSet);
  });
  const on = (name: string, action: () => void): void => { root.querySelector(`[data-action="${name}"]`)?.addEventListener('click', action); };
  root.querySelector<HTMLSelectElement>('[data-action="difficulty"]')?.addEventListener('change', event => actions.difficulty((event.currentTarget as HTMLSelectElement).value as BotSetup));
  on('draw-stock', () => actions.draw('stock'));
  on('draw-discard', () => actions.draw('discard'));
  on('discard', actions.discard);
  on('lay-phase', actions.lay);
  on('clear', actions.clear);
  on('next-round', actions.nextRound);
  on('multiplayer', () => actions.multiplayer?.());
  on('multiplayer-leave', () => actions.leaveMultiplayer?.());
  on('multiplayer-restart', () => actions.restartMultiplayer?.());
  on('order-mode', actions.orderMode);
  on('sort-number', () => actions.sort('number'));
  on('sort-color', () => actions.sort('color'));
  on('move-left', () => actions.orderStep(-1));
  on('move-right', () => actions.orderStep(1));
  root.querySelector<HTMLSelectElement>('[data-action="skip-target"]')?.addEventListener('change', event => actions.target((event.currentTarget as HTMLSelectElement).value));
  root.querySelectorAll<HTMLButtonElement>('[data-hit-owner]').forEach(button => button.addEventListener('click', () => actions.hit(button.dataset.hitOwner!, Number(button.dataset.hitGroup))));
  root.querySelector<HTMLElement>('.hand-grid')?.style.setProperty('--hand-count', String(Math.max(1, state ? viewer(view).hand.length : 1)));
  const scroll = root.querySelector<HTMLElement>('.table-scroll');
  if (scroll) scroll.scrollTop = tableScroll;
  root.querySelectorAll<HTMLDetailsElement>('details[data-panel]').forEach(panel => { panel.open = openPanels.has(panel.dataset.panel); });
  wireHand(root, ordering, actions);
  if (previouslyFocused) {
    const element = [...root.querySelectorAll<HTMLElement>('[data-focus]')].find(node => node.dataset.focus === previouslyFocused);
    if (element && !(element instanceof HTMLButtonElement && element.disabled)) element.focus({ preventScroll: true });
  }
}
