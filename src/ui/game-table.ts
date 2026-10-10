import { describeCard, eligibleSkipTargets } from '../game/game.js';
import type { Card, Catalog, GameState } from '../game/types.js';

export interface TableActions {
  start(computers: number): void;
  draw(source: 'stock' | 'discard'): void;
  select(id: string): void;
  target(id: string): void;
  discard(): void;
}

export interface TableView {
  state: GameState | null;
  catalog: Catalog;
  selected: string | null;
  target: string | null;
  message: string;
}

const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const image = (card: Card): string => `<img src="./${escape(card.asset)}" width="240" height="336" alt="${escape(describeCard(card))}" draggable="false">`;
const cardCount = (count: number): string => `${count} ${count === 1 ? 'Karte' : 'Karten'}`;

function startForm(restart: boolean, count = 2): string {
  return `<form class="start-form"><label for="computer-count">Computergegner</label><select id="computer-count" name="computers">${[1, 2, 3, 4, 5].map(value => `<option value="${value}"${value === count ? ' selected' : ''}>${value}</option>`).join('')}</select><button class="game-primary" type="submit">${restart ? 'Neu starten' : 'Partie starten'}</button>${restart ? '<p class="reset-note">Die aktuelle Partie wird ersetzt.</p>' : ''}</form>`;
}

export function renderGameTable(root: HTMLElement, view: TableView, actions: TableActions): void {
  const { state, catalog, selected, target, message } = view;
  const previouslyFocused = root.contains(document.activeElement) && document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.focus ?? null : null;
  if (state === null) {
    root.innerHTML = `<div class="game-start"><div class="start-card-art" aria-hidden="true"><img src="./public/assets/card-back.svg" width="240" height="336" alt=""><img src="./public/assets/card-green-07.svg" width="240" height="336" alt=""></div><div><p class="eyebrow">DEIN PLATZ AM TISCH</p><h2>Eine neue Partie.</h2><p>Du erhältst zehn Karten. Die Hände der Computergegner bleiben verdeckt.</p>${startForm(false)}</div></div>${message ? `<p class="game-message" role="alert">${escape(message)}</p>` : ''}`;
  } else {
    const active = state.players[state.currentPlayer]!;
    const human = state.players[0]!;
    const yourTurn = active.controller === 'human';
    const canDraw = yourTurn && state.stage === 'draw';
    const canDiscard = yourTurn && state.stage === 'discard';
    const topId = state.discard[state.discard.length - 1];
    const top = topId ? catalog.get(topId)! : null;
    const selectedCard = selected ? catalog.get(selected) ?? null : null;
    const skipTargets = eligibleSkipTargets(state);
    const needsTarget = selectedCard?.type === 'skip';
    const hand = [...human.hand].sort((a, b) => {
      const first = catalog.get(a)!;
      const second = catalog.get(b)!;
      const rank = (card: Card): number => card.type === 'number' ? card.value : card.type === 'wild' ? 13 : 14;
      return rank(first) - rank(second) || (first.color ?? '').localeCompare(second.color ?? '');
    });
    const title = yourTurn ? 'Du bist am Zug.' : `${active.name} ist am Zug.`;
    const instruction = yourTurn
      ? canDraw ? 'Ziehe genau eine Karte von einem der beiden Stapel.' : 'Wähle eine Karte aus deiner Hand und wirf sie ab.'
      : state.stage === 'draw' ? 'Zieht gleich eine Karte.' : 'Wählt eine Karte zum Abwerfen.';
    root.dataset.stage = state.stage;
    root.dataset.player = active.id;
    root.innerHTML = `<div class="game-topline"><span class="round-label">RUNDE ${state.round}</span><details class="new-game"><summary>Neue Partie</summary>${startForm(true, state.players.length - 1)}</details></div>
<div class="opponents">${state.players.slice(1).map(player => `<div class="opponent${player.id === active.id ? ' is-active' : ''}"><div class="opponent-cards" aria-hidden="true"><img src="./public/assets/card-back.svg" width="240" height="336" alt=""><img src="./public/assets/card-back.svg" width="240" height="336" alt=""><img src="./public/assets/card-back.svg" width="240" height="336" alt=""></div><strong>${escape(player.name)}</strong><span>${cardCount(player.hand.length)}${player.skipPending ? ' · setzt aus' : ''}</span></div>`).join('')}</div>
<div class="turn-heading"><h2>${escape(title)}</h2><p>${escape(instruction)}</p><ol class="turn-steps" aria-label="Schritte deines Zuges"><li class="${state.stage === 'draw' ? 'is-current' : 'is-complete'}"${yourTurn && state.stage === 'draw' ? ' aria-current="step"' : ''}><span>1</span>Ziehen</li><li class="${state.stage === 'discard' ? 'is-current' : ''}"${yourTurn && state.stage === 'discard' ? ' aria-current="step"' : ''}><span>2</span>Abwerfen</li></ol></div>
<div class="piles"><div><button class="pile-card" id="draw-stock" type="button" data-action="draw-stock" data-focus="draw-stock" aria-label="Eine Karte vom Nachziehstapel ziehen"${canDraw ? '' : ' disabled'}><img src="./public/assets/card-back.svg" width="240" height="336" alt="Verdeckter Nachziehstapel"><span class="pile-count">${state.stock.length}</span></button><span class="pile-label">Nachziehstapel</span></div><div><button class="pile-card" id="draw-discard" type="button" data-action="draw-discard" data-focus="draw-discard" aria-label="Die oberste Karte vom Ablagestapel aufnehmen"${canDraw && top && top.type !== 'skip' ? '' : ' disabled'}>${top ? image(top) : '<span class="empty-pile">Leer</span>'}<span class="pile-count">${state.discard.length}</span></button><span class="pile-label">Ablagestapel</span></div></div>
${top?.type === 'skip' ? '<p class="pile-hint">Aussetzen darf nicht vom Ablagestapel aufgenommen werden.</p>' : ''}
<div class="hand-heading"><h3>Deine Hand</h3><span id="hand-count">${cardCount(human.hand.length)}</span></div>
<div class="hand-grid">${hand.map(id => `<button class="hand-card${selected === id ? ' is-selected' : ''}${state.drawnCard === id && yourTurn ? ' is-drawn' : ''}" type="button" data-card="${escape(id)}" data-focus="${escape(id)}" aria-label="${escape(describeCard(catalog.get(id)!))} zum Abwerfen auswählen" aria-pressed="${selected === id}"${canDiscard ? '' : ' disabled'}>${image(catalog.get(id)!)}</button>`).join('')}</div>
<div class="discard-controls">${needsTarget ? `<label class="skip-target">Wer setzt aus?<select data-action="skip-target" data-focus="skip-target" aria-label="Spieler zum Aussetzen auswählen"><option value="">Bitte wählen</option>${skipTargets.map(player => `<option value="${escape(player.id)}"${target === player.id ? ' selected' : ''}>${escape(player.name)}</option>`).join('')}</select></label>${skipTargets.length ? '' : '<p>Wähle eine andere Karte. Die anderen Spieler müssen erst wieder einen normalen Zug spielen.</p>'}` : ''}<button class="game-primary" id="discard-card" type="button" data-action="discard" data-focus="discard"${canDiscard && selectedCard && (!needsTarget || skipTargets.some(player => player.id === target)) ? '' : ' disabled'}>${selectedCard ? `${escape(describeCard(selectedCard))} abwerfen` : 'Karte abwerfen'}</button><span class="selection-hint">${canDraw && yourTurn ? 'Erst ziehen, dann abwerfen.' : canDiscard && !selected ? 'Tippe auf eine deiner Karten.' : ''}</span></div>
${message ? `<p class="game-message" role="alert">${escape(message)}</p>` : ''}
<details class="turn-history"><summary>Letzte Züge</summary><ol>${state.history.map(entry => `<li>${escape(entry)}</li>`).join('')}</ol></details>`;
  }

  root.querySelector<HTMLFormElement>('.start-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    actions.start(Number(new FormData(form).get('computers')));
  });
  root.querySelector<HTMLButtonElement>('[data-action="draw-stock"]')?.addEventListener('click', () => actions.draw('stock'));
  root.querySelector<HTMLButtonElement>('[data-action="draw-discard"]')?.addEventListener('click', () => actions.draw('discard'));
  root.querySelector<HTMLButtonElement>('[data-action="discard"]')?.addEventListener('click', actions.discard);
  root.querySelectorAll<HTMLButtonElement>('[data-card]').forEach(button => button.addEventListener('click', () => actions.select(button.dataset.card!)));
  root.querySelector<HTMLSelectElement>('[data-action="skip-target"]')?.addEventListener('change', event => actions.target((event.currentTarget as HTMLSelectElement).value));
  if (previouslyFocused) {
    const element = [...root.querySelectorAll<HTMLElement>('[data-focus]')].find(node => node.dataset.focus === previouslyFocused);
    if (element && !(element instanceof HTMLButtonElement && element.disabled)) element.focus({ preventScroll: true });
  }
}
