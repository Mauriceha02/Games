import { LocalMatch, readSnapshot, type Snapshot, type GameAction } from '../game/local-match.js';
import { sortedCards, createHumanGame } from '../game/game.js';
import type { Catalog, PhaseSet } from '../game/types.js';
import { isPhaseSet, phaseSetName, type PhaseDefinitions } from '../game/phases.js';
import { loadTransport, type Role, type RoomLink } from '../network/transport.js';
import { renderGameTable, phaseSetOptions, type TableActions } from './game-table.js';
import { wireHand } from './hand-drag.js';

interface Options { catalog: Catalog; phases: PhaseDefinitions; phaseSet?: PhaseSet; signal: AbortSignal; invite?: string; onBack(): void; onPlaying(value: boolean): void }
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function mountLocalPhase10(root: HTMLElement, options: Options): Promise<{ dispose(): void; invitation(code: string): void }> {
  const { transport, signals, rooms } = await loadTransport();
  const service = await rooms.getServiceURL();
  if (options.signal.aborted) throw new Error('Mehrspielermodus abgebrochen.');
  let disposed = false;
  let role: Role | null = null;
  let incoming = options.invite ?? '';
  let outgoing = '';
  let linkMode = service !== null;
  let room: RoomLink | null = null;
  let reply = '';
  let internet = false;
  let phaseSet = options.phaseSet ?? 'classic';
  let busy = false;
  let generation = 0;
  let status = 'Einladen oder beitreten';
  let notice = '';
  let match: LocalMatch | null = null;
  let snapshot: Snapshot | null = null;
  let requestId = 0;
  let pending: number | null = null;
  let selected: string[] = [];
  let target: string | null = null;
  let ordering = false;
  let focused: string | null = null;
  let hand: string[] = [];
  let dragging = false;
  let renderPending = false;
  const events = new AbortController();
  const yourId = (): string => role === 'host' ? 'player-0' : 'player-1';

  function publish(): void {
    if (!match || peer.state !== 'connected') return;
    peer.send({ type: 'phase10.snapshot', data: match.snapshot('guest') });
    apply(match.snapshot('host'));
  }
  function apply(value: unknown): void {
    const next = readSnapshot(value, options.catalog, yourId());
    const fresh = snapshot?.match !== next.match;
    if (!fresh && snapshot && next.revision <= snapshot.revision) return;
    if (fresh) { requestId = 0; pending = null; hand = []; ordering = false; }
    if (fresh || snapshot?.state.round !== next.state.round) hand = [];
    snapshot = next; selected = []; target = null; notice = '';
    const cards = next.state.players.find(player => player.id === yourId())!.hand;
    hand = [...hand.filter(id => cards.includes(id)), ...cards.filter(id => !hand.includes(id))];
    if (focused && !hand.includes(focused)) focused = null;
    options.onPlaying(true); render();
  }
  function action(value: GameAction): void {
    if (!snapshot || pending !== null || peer.state !== 'connected') return;
    const request = { type: 'phase10.action' as const, id: ++requestId, match: snapshot.match, revision: snapshot.revision, action: value };
    try {
      if (role === 'host') {
        const result = match!.dispatch('host', request);
        if (result.changed) publish(); else { notice = result.receipt.error ?? ''; render(); }
      } else { pending = request.id; peer.send(request); render(); }
    } catch (error) { pending = null; notice = error instanceof Error ? error.message : 'Zug konnte nicht übertragen werden.'; render(); }
  }
  function move(id: string, position: number): void {
    const current = hand.indexOf(id);
    if (!ordering || current < 0 || position < 0 || position >= hand.length) return;
    hand.splice(current, 1); hand.splice(position, 0, id); focused = id; render();
  }
  const actions: TableActions = {
    start: () => {}, difficulty: () => {}, nextRound: () => action({ kind: 'next-round' }),
    draw: source => action({ kind: 'draw', source }),
    select: id => {
      if (!hand.includes(id)) return;
      if (ordering) focused = focused === id ? null : id;
      else {
        if (!snapshot || pending !== null || peer.state !== 'connected' || snapshot.state.players[snapshot.state.currentPlayer]!.id !== yourId() || snapshot.state.stage !== 'discard' || snapshot.state.status !== 'playing') return;
        selected = selected.includes(id) ? selected.filter(card => card !== id) : [...selected, id]; target = null;
      }
      notice = ''; render();
    },
    clear: () => { selected = []; target = null; render(); },
    target: id => { target = id || null; render(); },
    discard: () => { if (selected.length === 1) action({ kind: 'discard', card: selected[0]!, target }); },
    lay: () => action({ kind: 'lay', cards: [...selected] }),
    hit: (owner, group) => action({ kind: 'hit', cards: [...selected], owner, group }),
    orderMode: () => { ordering = !ordering; focused = null; render(); },
    move, orderStep: direction => { if (focused) move(focused, hand.indexOf(focused) + direction); },
    sort: by => { hand = sortedCards(hand, options.catalog, by); focused = null; render(); },
    dragging: active => { dragging = active; if (!active && renderPending) { renderPending = false; render(); } },
    leaveMultiplayer: options.onBack,
    restartMultiplayer: () => { if (role === 'host' && snapshot?.state.status === 'finished' && peer.state === 'connected') { match = new LocalMatch(options.catalog, createHumanGame(options.catalog, Math.random, phaseSet)); publish(); } },
  };
  const peer = new transport.LocalPeer({
    onState(state, message) {
      if (disposed) return;
      status = message || ({ idle: 'Einladen oder beitreten', preparing: 'Verbindung vorbereiten …', waiting: 'Warte auf deinen Mitspieler', connecting: 'Geräte verbinden …', connected: 'Verbunden', interrupted: 'Verbindung unterbrochen', failed: 'Verbindung beendet', closed: 'Verbindung beendet' } as Record<string, string>)[state] || state;
      if (state !== 'connected') pending = null;
      if (state === 'connected' && role === 'host') { if (!match) match = new LocalMatch(options.catalog, createHumanGame(options.catalog, Math.random, phaseSet)); publish(); }
      else render();
    },
    onMessage(value) {
      if (!record(value)) throw new Error('Ungültige Spielnachricht.');
      if (role === 'host') {
        if (value.type !== 'phase10.action' || !match) throw new Error('Ungültige Spielaktion.');
        const result = match.dispatch('guest', value);
        if (result.changed) publish();
        peer.send(result.receipt);
      } else if (value.type === 'phase10.snapshot') apply(value.data);
      else if (value.type === 'phase10.receipt' && Number.isSafeInteger(value.id) && (value.error === null || (typeof value.error === 'string' && value.error.length <= 250))) {
        if (value.id === pending) { pending = null; notice = value.error ?? ''; render(); }
      } else throw new Error('Ungültige Nachricht des Gastgebers.');
    },
  });
  if (service) room = new rooms.RoomLink(service, peer, message => { if (!disposed) { peer.close(); notice = message; render(); } });
  function shareValue(): string {
    if (!rooms.readRoomInvite(outgoing)) return outgoing;
    const url = new URL('./', document.baseURI); url.hash = `game?${new URLSearchParams({ invite: outgoing })}`;
    return url.href;
  }
  function linkPanel(): string {
    if (rooms.readRoomInvite(outgoing)) return `<h3>${phaseSetName(phaseSet)} · Einladung teilen</h3><p>Dein Mitspieler öffnet diesen Link. Ihr werdet automatisch verbunden – ohne Antwortcode.</p><label>Einladungslink<textarea readonly rows="3" data-output>${escape(shareValue())}</textarea></label><div class="connection-share"><button class="game-primary" type="button" data-local="share">Teilen …</button><button class="game-secondary" type="button" data-local="copy">Link kopieren</button></div>`;
    if (linkMode && role === 'guest') return '<h3>Mitspieler wird verbunden</h3><p>Lass dieses Fenster geöffnet. Die Verbindung wird automatisch vorbereitet.</p>';
    return '';
  }
  async function join(): Promise<void> {
    if (rooms.readRoomInvite(incoming)) {
      if (!room) throw new Error('Einladungslinks sind hier noch nicht eingerichtet. Bitte öffne die aktuelle App.');
      linkMode = true; role = 'guest'; await room.join(incoming, 'phase10');
    } else {
      room?.close(); linkMode = false;
      const invitation = signals.readSignal(incoming);
      if (invitation.game !== 'phase10' || invitation.type !== 'offer') throw new Error('Du brauchst eine Phase10-Einladung.');
      role = 'guest'; outgoing = await peer.joinInvitation(incoming);
    }
  }
  function render(): void {
    if (disposed) return;
    if (dragging) { renderPending = true; return; }
    if (snapshot) {
      const state = { ...snapshot.state, players: snapshot.state.players.map(player => player.id === yourId() ? { ...player, hand: [...hand] } : player) };
      renderGameTable(root, { state, catalog: options.catalog, phases: options.phases, selected, target, message: notice, ordering, focusedCard: focused, viewerId: yourId(), network: { connected: peer.state === 'connected', host: role === 'host', pending: pending !== null, status } }, actions);
      if (peer.state !== 'connected') {
        const banner = document.createElement('div'); banner.className = 'connection-lost'; banner.setAttribute('role', 'status');
        banner.textContent = `${status} Öffne eine neue Einladung, falls die Verbindung nicht zurückkommt.`;
        root.querySelector('.table-fixed-top')?.prepend(banner);
      }
      return;
    }
    delete root.dataset.status; delete root.dataset.stage; delete root.dataset.player;
    root.innerHTML = `<section class="multiplayer-lobby"><button class="game-secondary" type="button" data-local="back">← Zur Solopartie</button><h2>Phase10 zusammen spielen</h2><p>Öffnet Phase10 auf beiden Geräten im selben WLAN. Jeder sieht nur seine eigene Hand.</p><p class="connection-status" role="status">${escape(status)}</p>${linkPanel() || (outgoing ? `<h3>${role === 'host' ? 'Einladung teilen' : 'Antwort zurückgeben'}</h3><p>${role === 'host' ? 'Dein Mitspieler tritt mit deiner Einladung bei und gibt dir seinen Antwortcode zurück.' : 'Gib diesen Code an den Gastgeber zurück. Er fügt ihn in seinem ursprünglichen Fenster ein. Lass dieses Fenster geöffnet.'}</p><label>Dein ${role === 'host' ? 'Einladungscode' : 'Antwortcode'}<textarea readonly rows="3" data-output>${escape(outgoing)}</textarea></label><div class="connection-share"><button class="game-primary" type="button" data-local="share">Teilen …</button><button class="game-secondary" type="button" data-local="copy">Code kopieren</button></div>${role === 'host' ? `<form data-form="answer"><label>Antwortcode<textarea name="answer" rows="3" maxlength="34816" required spellcheck="false" autocapitalize="off">${escape(reply)}</textarea></label><button class="game-primary" type="submit"${busy ? ' disabled' : ''}>Verbinden</button></form>` : ''}` : `<form data-form="create"><label for="local-phase-set">Phasen<select id="local-phase-set" name="phaseSet">${phaseSetOptions(phaseSet)}</select></label><p class="connection-note">Extrem spielt ihr mit eigenen, schwierigeren Phasen.</p><label class="connection-check"><input type="checkbox" name="internet"${internet ? ' checked' : ''}>Internet-Hilfe für die Verbindung nutzen</label><button class="game-primary" type="submit"${busy ? ' disabled' : ''}>${linkMode ? 'Einladungslink erstellen' : 'Einladungscode erstellen'}</button></form><form data-form="join"><h3>Einladung annehmen</h3><label>Einladungslink oder Code<textarea name="invite" rows="3" maxlength="34816" required spellcheck="false" autocapitalize="off">${escape(incoming)}</textarea></label><button class="game-primary" type="submit"${busy ? ' disabled' : ''}>Beitreten</button></form>`)}${service && !outgoing && !role ? `<button class="game-secondary" type="button" data-local="mode"${busy ? ' disabled' : ''}>${linkMode ? 'Ohne Internet per Code verbinden' : 'Per Einladungslink verbinden'}</button>` : ''}<p class="connection-note">Einladungen gelten 15 Minuten. Für Einladungslinks braucht ihr kurz Internet. Ohne Internet könnt ihr Codes nutzen. Die Internet-Hilfe nutzt Googles STUN-Dienst. Spielnachrichten werden direkt übertragen.</p><p class="connection-note">Beide Geräte geöffnet lassen. Schließen, Neuladen oder Verlassen beendet die gemeinsame Partie. Eure Solospielstände bleiben erhalten.</p><p class="connection-notice" role="alert">${escape(notice)}</p><button class="game-secondary" type="button" data-local="reset"${busy ? ' disabled' : ''}>Neu verbinden</button></section>`;
  }
  async function run(callback: () => Promise<void>): Promise<void> {
    if (busy) return;
    const token = generation; busy = true; notice = ''; render();
    try { await callback(); } catch (error) { if (!disposed && token === generation) notice = error instanceof Error ? error.message : 'Verbindung fehlgeschlagen.'; }
    finally { if (!disposed && token === generation) { busy = false; render(); } }
  }
  root.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement) {
      if (event.target.name === 'invite') incoming = event.target.value;
      if (event.target.name === 'answer') reply = event.target.value;
    }
  }, { signal: events.signal });
  root.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.dataset.form) return;
    event.preventDefault(); const form = event.target.dataset.form; const data = new FormData(event.target);
    void run(async () => {
      if (form === 'create') { const chosen = data.get('phaseSet'); if (!isPhaseSet(chosen)) throw new Error('Wähle Klassisch oder Extrem.'); phaseSet = chosen; internet = data.has('internet'); role = 'host'; outgoing = room && linkMode ? await room.create('phase10', internet) : await peer.createInvitation('phase10', internet); }
      else if (form === 'join') {
        incoming = String(data.get('invite')); await join();
      } else if (form === 'answer') { reply = String(data.get('answer')); await peer.acceptAnswer(reply); }
    });
  }, { signal: events.signal });
  root.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-local]') : null;
    if (!button || !root.contains(button) || button.disabled) return;
    const action = button.dataset.local;
    if (action === 'back') { options.onBack(); return; }
    if (action === 'mode') { linkMode = !linkMode; notice = ''; render(); return; }
    if (action === 'reset') {
      room?.close();
      generation++; snapshot = null; match = null; role = null; outgoing = ''; reply = ''; incoming = ''; busy = false; pending = null; notice = ''; hand = [];
      options.onPlaying(false); peer.close(); render(); return;
    }
    if (action === 'copy' || action === 'share') void (async () => {
      try {
        if (action === 'share' && navigator.share) {
          const url = new URL('./', document.baseURI); url.hash = `game?${new URLSearchParams({ invite: outgoing })}`;
          await navigator.share(role === 'host' ? { title: 'Phase10 zusammen spielen', url: url.href } : { title: 'Phase10-Antwortcode', text: outgoing });
        } else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareValue()); notice = rooms.readRoomInvite(outgoing) ? 'Link kopiert.' : 'Code kopiert.'; render(); }
        else { const field = root.querySelector<HTMLTextAreaElement>('[data-output]'); field?.focus(); field?.select(); }
      } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) { notice = 'Du kannst den Code markieren und kopieren.'; render(); } }
    })();
  }, { signal: events.signal });
  render();
  if (options.invite && rooms.readRoomInvite(options.invite)) void run(join);
  return {
    invitation(code: string): void { if (snapshot || peer.state === 'connected') { notice = 'Beende zuerst die aktuelle Partie.'; render(); } else { incoming = code; if (rooms.readRoomInvite(code)) void run(join); else render(); } },
    dispose(): void { disposed = true; generation++; events.abort(); room?.close(); wireHand(root, false, { select: () => {}, move: () => {}, dragging: () => {} }); peer.close(); root.replaceChildren(); },
  };
}
