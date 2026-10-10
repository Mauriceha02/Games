import { wireHand, type HandActions } from './hand-drag.js';
import { describeCard, eligibleSkipTargets } from '../game/game.js';
import { extendMeld, matchPhase, PHASE_GROUPS, type PhaseDefinition } from '../game/phases.js';
import type { Card, Catalog, GameState, Meld, BotSetup } from '../game/types.js';

export interface TableActions extends HandActions {
  start(computers: number, difficulty: BotSetup): void;
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
  state: GameState | null;
  catalog: Catalog;
  phases: PhaseDefinition[];
  selected: string[];
  target: string | null;
  message: string;
  ordering: boolean;
  focusedCard: string | null;
}

const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const image = (card: Card): string => `<img src="./${escape(card.asset)}" width="240" height="336" alt="${escape(describeCard(card))}" draggable="false">`;
const colorSymbol = { red: '●', blue: '■', green: '▲', yellow: '◆' };
const handImage = (card: Card): string => `${image(card)}<span class="hand-corner" data-color="${card.color ?? 'special'}" aria-hidden="true"><span>${card.type === 'number' ? card.value : card.type === 'wild' ? '✦' : 'Ø'}</span>${card.type === 'number' ? `<small>${colorSymbol[card.color]}</small>` : ''}</span>`;
const cardCount = (count: number): string => `${count} ${count === 1 ? 'Karte' : 'Karten'}`;
const disabled = (enabled: unknown): string => enabled ? '' : ' disabled';
const colorName = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };
const groupName = (group: Meld): string => group.kind === 'set' ? `${group.cards.length} × ${group.value}` : group.kind === 'color' ? colorName[group.color!] : `Folge ${group.value}–${group.value! + group.cards.length - 1}`;

function difficultyOptions(current: BotSetup): string {
  return ([['easy', 'Einfach'], ['strong', 'Stark'], ['mixed', 'Gemischt']] as const)
    .map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('');
}

function botSetup(state: GameState): BotSetup {
  const levels = state.players.slice(1).map(player => player.botDifficulty);
  return levels.every(level => level === levels[0]) ? levels[0]! : 'mixed';
}

function startForm(restart: boolean, count = 2, difficulty: BotSetup = 'easy'): string {
  return `<form class="start-form"><label for="computer-count">Computergegner</label><select id="computer-count" name="computers">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === count ? ' selected' : ''}>${value}</option>`).join('')}</select><label for="start-difficulty">Spielstärke</label><select id="start-difficulty" name="difficulty">${difficultyOptions(difficulty)}</select><button class="game-primary" type="submit">${restart ? 'Neu starten' : 'Partie starten'}</button>${restart ? '<p class="reset-note">Die aktuelle Partie wird ersetzt.</p>' : ''}</form>`;
}

function tableMelds(view: TableView, canPlay: boolean): string {
  const { state, catalog, selected } = view;
  if (!state?.players.some(player => player.melds.length)) return '';
  const canHit = canPlay && state.players[0]!.melds.length && selected.length;
  return `<section class="laid-phases" aria-label="Ausgelegte Phasen"><h3>Auf dem Tisch</h3>${state.players.filter(player => player.melds.length).map(player => `<div class="laid-player"><h4>${escape(player.name)} · Phase ${player.phase}</h4><div class="meld-groups">${player.melds.map((group, index) => `<div class="meld-group"><span class="meld-label">${escape(groupName(group))}</span><div class="meld-cards">${group.cards.map((id, offset) => `<div class="meld-card">${image(catalog.get(id)!)}${catalog.get(id)!.type === 'wild' ? `<span class="wild-value">${group.kind === 'color' ? colorName[group.color!] : group.kind === 'run' ? group.value! + offset : group.value}</span>` : ''}</div>`).join('')}</div>${state.status === 'playing' && state.players[0]!.melds.length ? `<button class="game-secondary" type="button" data-hit-owner="${escape(player.id)}" data-hit-group="${index}" data-focus="hit-${escape(player.id)}-${index}"${disabled(canHit && extendMeld(group, selected, catalog))}>Hier anlegen</button>` : ''}</div>`).join('')}</div></div>`).join('')}</section>`;
}

function result(view: TableView): string {
  const state = view.state!;
  if (state.status === 'playing') return '';
  const roundWinner = state.players.find(player => player.id === state.roundWinner)!;
  const winner = state.players.find(player => player.id === state.winner);
  const title = winner ? `${winner.name === 'Du' ? 'Du gewinnst' : `${winner.name} gewinnt`} die Partie!` : `${roundWinner.name} beendet Runde ${state.round}.`;
  return `<section class="round-result" aria-label="Rundenergebnis"><h2>${escape(title)}</h2><p>${winner ? 'Alle zehn Phasen sind geschafft.' : state.finalists ? 'Gleichstand nach Phase 10. Die punktgleichen Spieler spielen eine Stichrunde; die erste ausgelegte Phase entscheidet.' : 'Wer seine Phase ausgelegt hat, spielt in der nächsten Runde die nächste Phase.'}</p><ul>${state.players.map(player => `<li><strong>${escape(player.name)} <span class="bot-badge">${player.botDifficulty === 'strong' ? 'Stark' : 'Einfach'}</span></strong><span>Phase ${player.phase}${player.melds.length ? ' ✓' : ''} · ${player.score} Punkte</span></li>`).join('')}</ul>${state.status === 'round-over' ? '<button class="game-primary" type="button" data-action="next-round" data-focus="next-round">Nächste Runde</button>' : ''}</section>`;
}

export function renderGameTable(root: HTMLElement, view: TableView, actions: TableActions): void {
  const { state, catalog, phases, selected, target, message, ordering, focusedCard } = view;
  const previouslyFocused = root.contains(document.activeElement) && document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.focus ?? null : null;
  if (state === null) {
    root.innerHTML = `<div class="game-start"><div class="start-card-art" aria-hidden="true"><img src="./public/assets/card-back.svg" width="240" height="336" alt=""><img src="./public/assets/card-green-07.svg" width="240" height="336" alt=""></div><div><p class="eyebrow">DEIN PLATZ AM TISCH</p><h2>Eine neue Partie.</h2><p>Du erhältst zehn Karten. Die Hände der Computergegner bleiben verdeckt.</p>${startForm(false)}</div></div>${message ? `<p class="game-message" role="alert">${escape(message)}</p>` : ''}`;
  } else {
    const active = state.players[state.currentPlayer]!;
    const human = state.players[0]!;
    const yourTurn = active.controller === 'human' && state.status === 'playing';
    const canDraw = yourTurn && state.stage === 'draw';
    const canPlay = yourTurn && state.stage === 'discard' && !ordering;
    const topId = state.discard[state.discard.length - 1];
    const top = topId ? catalog.get(topId)! : null;
    const selectedCard = selected.length === 1 ? catalog.get(selected[0]!)! : null;
    const skipTargets = eligibleSkipTargets(state);
    const needsTarget = selectedCard?.type === 'skip' && !ordering;
    const phase = phases[human.phase - 1]!;
    const requiredCount = PHASE_GROUPS[human.phase - 1]!.reduce((total, group) => total + group.size, 0);
    const matched = canPlay && !human.melds.length && selected.length ? matchPhase(selected, human.phase, catalog) : null;
    const position = focusedCard ? human.hand.indexOf(focusedCard) : -1;
    const spectator = state.tieBreak && !state.finalists?.includes(human.id);
    const title = spectator ? 'Die Stichrunde läuft.' : yourTurn ? 'Du bist am Zug.' : `${active.name} ist am Zug.`;
    const instruction = ordering ? 'Ziehe die Karten mit dem Finger an ihren Platz.' : yourTurn
      ? canDraw ? 'Ziehe genau eine Karte von einem der beiden Stapel.' : human.melds.length ? 'Lege passende Karten an oder wirf eine Karte ab.' : 'Wähle Karten für deine Phase oder eine Karte zum Abwerfen.'
      : state.stage === 'draw' ? 'Zieht gleich eine Karte.' : 'Prüft die Phase und die Karten auf dem Tisch.';
    root.dataset.stage = state.stage;
    root.dataset.player = active.id;
    root.dataset.status = state.status;
    root.innerHTML = `<div class="game-topline"><span class="round-label">${state.tieBreak ? 'STICHRUNDE' : 'RUNDE'} ${state.round}</span><label class="bot-setting" for="bot-difficulty">Spielstärke<select id="bot-difficulty" data-focus="bot-difficulty" data-action="difficulty">${difficultyOptions(botSetup(state))}</select></label><details class="new-game"><summary>Neue Partie</summary>${startForm(true, state.players.length - 1, botSetup(state))}</details></div>
<div class="current-phase"><img src="./public/assets/phase-${String(human.phase).padStart(2, '0')}.svg" width="240" height="336" alt="" aria-hidden="true"><div><span class="eyebrow">DEINE PHASE ${human.phase} VON 10</span><h3>${escape(phase.title)}</h3><p>${escape(phase.hint)}</p><span class="phase-progress">${spectator ? 'Du schaust bei der Stichrunde zu.' : human.melds.length ? `✓ Ausgelegt${human.phase < 10 ? ` · Phase ${human.phase + 1} in der nächsten Runde` : ' · Letzte Phase geschafft'}` : `${requiredCount} Karten mindestens · ${human.score} Punkte`}</span></div></div>
<div class="opponents">${state.players.slice(1).map(player => `<div class="opponent${player.id === active.id && state.status === 'playing' ? ' is-active' : ''}"><div class="opponent-cards" aria-hidden="true">${Array.from({ length: Math.min(3, player.hand.length) }, () => '<img src="./public/assets/card-back.svg" width="240" height="336" alt="">').join('')}</div><strong>${escape(player.name)} <span class="bot-badge">${player.botDifficulty === 'strong' ? 'Stark' : 'Einfach'}</span></strong><span>${cardCount(player.hand.length)}${player.skipPending ? ' · setzt aus' : ''}</span><span>Phase ${player.phase}${player.melds.length ? ' ✓' : ''}</span></div>`).join('')}</div>
${result(view)}
${state.status === 'playing' ? `<div class="turn-heading"><h2>${escape(title)}</h2><p>${escape(instruction)}</p><ol class="turn-steps" aria-label="Schritte deines Zuges"><li class="${state.stage === 'draw' ? 'is-current' : 'is-complete'}"${canDraw ? ' aria-current="step"' : ''}><span>1</span>Ziehen</li><li class="${state.stage === 'discard' ? 'is-current' : ''}"${canPlay ? ' aria-current="step"' : ''}><span>2</span>Spielen &amp; Abwerfen</li></ol></div>` : ''}
<div class="piles"><div><button class="pile-card" id="draw-stock" type="button" data-action="draw-stock" data-focus="draw-stock" aria-label="Eine Karte vom Nachziehstapel ziehen"${disabled(canDraw && !ordering && (state.stock.length || state.discard.length > 1))}><img src="./public/assets/card-back.svg" width="240" height="336" alt="Verdeckter Nachziehstapel"><span class="pile-count">${state.stock.length}</span></button><span class="pile-label">Nachziehstapel</span></div><div><button class="pile-card" id="draw-discard" type="button" data-action="draw-discard" data-focus="draw-discard" aria-label="Die oberste Karte vom Ablagestapel aufnehmen"${disabled(canDraw && !ordering && top && top.type !== 'skip')}>${top ? image(top) : '<span class="empty-pile">Leer</span>'}<span class="pile-count">${state.discard.length}</span></button><span class="pile-label">Ablagestapel</span></div></div>
${top?.type === 'skip' ? '<p class="pile-hint">Aussetzen darf nicht vom Ablagestapel aufgenommen werden.</p>' : ''}
${tableMelds(view, canPlay)}
<div class="hand-heading"><h3>Deine Hand</h3><span id="hand-count">${cardCount(human.hand.length)}</span></div>
<div class="hand-tools"><button class="game-secondary" type="button" data-action="sort-number" data-focus="sort-number"${disabled(human.hand.length)}>Nach Zahl</button><button class="game-secondary" type="button" data-action="sort-color" data-focus="sort-color"${disabled(human.hand.length)}>Nach Farbe</button><button class="game-secondary" type="button" data-action="order-mode" data-focus="order-mode" aria-pressed="${ordering}"${disabled(human.hand.length)}>${ordering ? 'Ordnen fertig' : 'Hand ordnen'}</button></div>
${ordering ? `<p class="ordering-hint">Karte berühren, an den gewünschten Platz ziehen und loslassen. Alternativ: antippen und die Pfeile nutzen.</p>` : ''}
<div class="hand-grid${ordering ? ' is-ordering' : ''}">${human.hand.map(id => `<button class="hand-card${(ordering ? focusedCard === id : selected.includes(id)) ? ' is-selected' : ''}${state.drawnCard === id && yourTurn ? ' is-drawn' : ''}" type="button" data-card="${escape(id)}" data-focus="${escape(id)}" aria-label="${escape(describeCard(catalog.get(id)!))}${ordering ? ' zum Verschieben' : ' auswählen'}" aria-pressed="${ordering ? focusedCard === id : selected.includes(id)}"${disabled(ordering || canPlay)}>${handImage(catalog.get(id)!)}</button>`).join('')}</div>
${ordering ? `<div class="order-controls"><button class="game-secondary" type="button" data-action="move-left" data-focus="move-left" aria-label="Gewählte Karte einen Platz nach links verschieben"${disabled(position > 0)}>← Nach links</button><span>${position >= 0 ? `Platz ${position + 1} von ${human.hand.length}` : 'Eine Karte auswählen'}</span><button class="game-secondary" type="button" data-action="move-right" data-focus="move-right" aria-label="Gewählte Karte einen Platz nach rechts verschieben"${disabled(position >= 0 && position < human.hand.length - 1)}>Nach rechts →</button></div>` : `<div class="selection-status" role="status">${selected.length ? `${selected.length} ausgewählt${matched ? ` · ${matched.map(group => escape(groupName(group))).join(' + ')} ✓` : !human.melds.length && selected.length > 1 ? ' · noch keine vollständige Phase' : ''}` : canDraw ? 'Erst ziehen, dann spielen.' : canPlay ? 'Tippe auf eine oder mehrere Karten.' : ''}</div><div class="discard-controls">${!human.melds.length ? `<button class="game-primary" id="lay-phase" type="button" data-action="lay-phase" data-focus="lay-phase"${disabled(matched)}>Phase ${human.phase} auslegen</button>` : ''}${needsTarget ? `<label class="skip-target">Wer setzt aus?<select data-action="skip-target" data-focus="skip-target" aria-label="Spieler zum Aussetzen auswählen"><option value="">Bitte wählen</option>${skipTargets.map(player => `<option value="${escape(player.id)}"${target === player.id ? ' selected' : ''}>${escape(player.name)}</option>`).join('')}</select></label>${skipTargets.length ? '' : '<p>Wähle eine andere Karte. Die anderen Spieler müssen erst wieder einen normalen Zug spielen.</p>'}` : ''}<button class="game-primary" id="discard-card" type="button" data-action="discard" data-focus="discard"${disabled(canPlay && selectedCard && (!needsTarget || skipTargets.some(player => player.id === target)))}>${selectedCard ? `${escape(describeCard(selectedCard))} abwerfen` : 'Eine Karte abwerfen'}</button>${selected.length ? '<button class="game-secondary" type="button" data-action="clear" data-focus="clear">Auswahl aufheben</button>' : ''}</div>`}
${message ? `<p class="game-message" role="alert">${escape(message)}</p>` : ''}
<details class="turn-history"><summary>Letzte Züge</summary><ol>${state.history.map(entry => `<li>${escape(entry)}</li>`).join('')}</ol></details>`;
  }

  root.querySelector<HTMLFormElement>('.start-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    actions.start(Number(data.get('computers')), String(data.get('difficulty')) as BotSetup);
  });
  const on = (name: string, action: () => void): void => { root.querySelector(`[data-action="${name}"]`)?.addEventListener('click', action); };
  root.querySelector<HTMLSelectElement>('[data-action="difficulty"]')?.addEventListener('change', event => actions.difficulty((event.currentTarget as HTMLSelectElement).value as BotSetup));
  on('draw-stock', () => actions.draw('stock'));
  on('draw-discard', () => actions.draw('discard'));
  on('discard', actions.discard);
  on('lay-phase', actions.lay);
  on('clear', actions.clear);
  on('next-round', actions.nextRound);
  on('order-mode', actions.orderMode);
  on('sort-number', () => actions.sort('number'));
  on('sort-color', () => actions.sort('color'));
  on('move-left', () => actions.orderStep(-1));
  on('move-right', () => actions.orderStep(1));
  root.querySelector<HTMLSelectElement>('[data-action="skip-target"]')?.addEventListener('change', event => actions.target((event.currentTarget as HTMLSelectElement).value));
  root.querySelectorAll<HTMLButtonElement>('[data-hit-owner]').forEach(button => button.addEventListener('click', () => actions.hit(button.dataset.hitOwner!, Number(button.dataset.hitGroup))));
  root.querySelector<HTMLElement>('.hand-grid')?.style.setProperty('--hand-count', String(Math.max(1, state?.players[0]?.hand.length ?? 1)));
  wireHand(root, ordering, actions);
  if (previouslyFocused) {
    const element = [...root.querySelectorAll<HTMLElement>('[data-focus]')].find(node => node.dataset.focus === previouslyFocused);
    if (element && !(element instanceof HTMLButtonElement && element.disabled)) element.focus({ preventScroll: true });
  }
}
