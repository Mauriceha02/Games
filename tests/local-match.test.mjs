import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog, createHumanGame, assertGameState, layPhase } from '../public/app/game/game.js';
import { LocalMatch, readSnapshot } from '../public/app/game/local-match.js';
import { matchPhase } from '../public/app/game/phases.js';
import { loadGame, saveGame } from '../public/app/storage/local-game.js';

const cards = JSON.parse(await readFile(new URL('../src/game/deck.json', import.meta.url), 'utf8'));
const catalog = createCatalog(cards);
const matchId = 'ab'.repeat(16);
const ids = value => cards.filter(card => card.type === 'number' && card.value === value).map(card => card.id);
const phase1 = [...ids(7).slice(0, 3), ...ids(9).slice(0, 3)];
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(hand = phase1, phase = 1, stage = 'discard') {
  const state = createHumanGame(catalog, () => .999999);
  const remaining = cards.map(card => card.id).filter(id => !hand.includes(id));
  state.players[0].hand = [...hand];
  while (state.players[0].hand.length < (stage === 'draw' ? 10 : 11)) state.players[0].hand.push(remaining.shift());
  state.players[0].phase = phase;
  state.players[0].skipProtected = false;
  state.players[1].hand = remaining.splice(0, 10);
  state.discard = [remaining.pop()]; state.stock = remaining; state.currentPlayer = 0;
  state.stage = stage; state.drawnCard = stage === 'discard' ? state.players[0].hand.at(-1) : null;
  assertGameState(state, catalog); return state;
}
function session(state = fixture(phase1, 1, 'draw')) {
  const match = new LocalMatch(catalog, state, matchId);
  const requests = { host: 0, guest: 0 };
  return { match, act(role, action, revision = match.snapshot(role).revision) {
    return match.dispatch(role, { type: 'phase10.action', id: ++requests[role], match: matchId, revision, action });
  } };
}
function valid(match) { for (const [role, viewer] of [['host','player-0'],['guest','player-1']]) readSnapshot(match.snapshot(role), catalog, viewer); }

test('two people are dealt ten cards and opening Skip can start with the guest', () => {
  for (const value of [.999999, .1, .5]) {
    const state = createHumanGame(catalog, () => value);
    assert(state.players.every(player => player.controller === 'human' && player.botDifficulty === null && player.hand.length === 10));
    assertGameState(state, catalog); valid(new LocalMatch(catalog, state, matchId));
  }
  const opening = [...cards];
  const skip = opening.findIndex(card => card.type === 'skip');
  [opening[87], opening[skip]] = [opening[skip], opening[87]];
  const state = createHumanGame(createCatalog(opening), () => .999999);
  assert.equal(state.currentPlayer, 1); assert(state.players[0].skipProtected);
});
test('snapshots contain only the viewer hand, public cards and pile counts', () => {
  const state = fixture(); const { match } = session(state);
  for (const role of ['host','guest']) {
    const snapshot = match.snapshot(role); const other = role === 'host' ? 1 : 0;
    assert.deepEqual(snapshot.state.players[other].hand, []);
    assert(!('stock' in snapshot.state));
    for (const hidden of [...state.stock, ...state.players[other].hand]) assert(!JSON.stringify(snapshot).includes('"'+hidden+'"'));
    assert.equal(snapshot.state.handCounts['player-'+other], state.players[other].hand.length);
    if (role === 'guest') assert.equal(snapshot.state.drawnCard, null);
  }
  const snapshot = match.snapshot('host'); snapshot.state.players[0].hand.pop();
  assert.equal(match.snapshot('host').state.players[0].hand.length, 11); valid(match);
});
test('the host enforces mandatory draw, ownership, turn order and one action per request', () => {
  const { match, act } = session(); const before = copy(match.snapshot('host'));
  assert.equal(act('guest', {kind:'draw',source:'stock'}).changed, false);
  assert.equal(act('host', {kind:'discard',card:phase1[0],target:null}).changed, false);
  assert.deepEqual(match.snapshot('host'), before);
  assert(act('host', {kind:'draw',source:'stock'}).changed);
  assert.equal(match.snapshot('host').state.players[0].hand.length, 11);
  assert.equal(act('host', {kind:'draw',source:'stock'}).changed, false);
  assert.equal(act('host', {kind:'discard',card:match.snapshot('guest').state.players[1].hand[0],target:null}).changed, false);
  assert.equal(act('host', {kind:'discard',card:phase1[0],target:null},0).changed, false);
  assert(act('host', {kind:'discard',card:phase1[0],target:null}).changed);
  valid(match); assert.equal(match.snapshot('guest').state.currentPlayer, 1);
  assert(act('guest', {kind:'draw',source:'discard'}).changed);
  const revision = match.snapshot('guest').revision;
  const request = {type:'phase10.action',id:3,match:matchId,revision,action:{kind:'discard',card:phase1[0],target:null}};
  assert(match.dispatch('guest',request).changed); const after=copy(match.snapshot('host'));
  assert.equal(match.dispatch('guest',request).changed,false); assert.deepEqual(match.snapshot('host'),after);
  assert.throws(()=>match.dispatch('guest',{...request,id:5})); valid(match);
});
test('a Skip requires a target and actually skips the other human', () => {
  const {match,act}=session(fixture(['skip-1'],1,'discard'));
  assert.equal(act('host',{kind:'discard',card:'skip-1',target:null}).changed,false);
  assert(act('host',{kind:'discard',card:'skip-1',target:'player-1'}).changed);
  assert.equal(match.snapshot('host').state.currentPlayer,0);
  assert(match.snapshot('guest').state.players[1].skipProtected); valid(match);
});
test('lay, hit, round scoring and phase advancement use the same rules for both humans', () => {
  const extras=ids(7).slice(3,7); const {match,act}=session(fixture([...phase1,...extras,'red-1-1']));
  assert.equal(act('host',{kind:'lay',cards:phase1.slice(1)}).changed,false);
  assert(act('host',{kind:'lay',cards:phase1}).changed); valid(match);
  assert.equal(match.snapshot('guest').state.players[0].melds.length,2);
  assert(act('host',{kind:'hit',cards:extras,owner:'player-0',group:0}).changed); valid(match);
  assert(act('host',{kind:'discard',card:'red-1-1',target:null}).changed); valid(match);
  assert.equal(match.snapshot('guest').state.status,'round-over');
  assert.equal(match.snapshot('guest').state.roundWinner,'player-0');
  assert(match.snapshot('guest').state.players[1].score>0);
  assert.equal(act('guest',{kind:'next-round'}).changed,false);
  assert(act('host',{kind:'next-round'}).changed); valid(match);
  assert.equal(match.snapshot('guest').state.round,2);
  assert.deepEqual(match.snapshot('guest').state.players.map(p=>p.phase),[2,1]);
});
test('the guest can lay its phase and hit a group belonging to the host', () => {
  let state=layPhase(fixture([...phase1,...ids(7).slice(3,7),'red-1-1']),catalog,'player-0',phase1);
  const guestPhase=[...ids(4).slice(0,3),...ids(5).slice(0,3)];
  state.players[1].hand=[...guestPhase,'yellow-7-2','red-2-1','red-3-1','red-6-1','blue-1-1'];
  // Give the host back the physical card that now belongs to the guest.
  state.players[0].hand=state.players[0].hand.filter(id=>!state.players[1].hand.includes(id));
  const held=[...state.discard,...state.players.flatMap(p=>[...p.hand,...p.melds.flatMap(m=>m.cards)])];
  state.stock=cards.map(c=>c.id).filter(id=>!held.includes(id)); state.currentPlayer=1; state.drawnCard='yellow-7-2';
  const {match,act}=session(state);
  assert(act('guest',{kind:'lay',cards:guestPhase}).changed);
  assert(act('guest',{kind:'hit',cards:['yellow-7-2'],owner:'player-0',group:0}).changed);
  valid(match); assert.equal(match.snapshot('host').state.players[0].melds[0].cards.length,4);
});
test('finishing phase ten ends the shared match and cannot start another round', () => {
  const phase=[...ids(6).slice(0,5),...ids(12).slice(0,3)];
  const {match,act}=session(fixture([...phase,...ids(6).slice(5,8)],10));
  assert(act('host',{kind:'lay',cards:phase}).changed);
  assert(act('host',{kind:'hit',cards:ids(6).slice(5,8),owner:'player-0',group:0}).changed);
  assert.equal(match.snapshot('guest').state.status,'finished');
  assert.equal(match.snapshot('guest').state.winner,'player-0');
  assert.equal(act('host',{kind:'next-round'}).changed,false); valid(match);
});
test('the guest rejects leaked hands, hidden stock, forged counts, IDs, layouts and progress', () => {
  const {match}=session(); const snapshot=match.snapshot('guest');
  for (const change of [
    s=>s.viewer='player-0', s=>s.state.stock=['red-1-1'], s=>s.state.stockCount=-1,
    s=>s.state.players[0].hand=['wild-1'], s=>s.state.handCounts['player-1']=1,
    s=>s.state.players[1].hand[0]='<img onerror=alert(1)>', s=>s.state.players[1].hand[0]=s.state.players[1].hand[1],
    s=>s.state.players[1].id='player-0', s=>s.state.stage='unknown', s=>s.state.status='finished',
    s=>s.state.players[0].melds=[{kind:'set',cards:['skip-1'],value:1,color:null}],
  ]) { const forged=copy(snapshot);change(forged);assert.throws(()=>readSnapshot(forged,catalog,'player-1')); }
});
test('shared games cannot overwrite or load as saved solo games', () => {
  const state=createHumanGame(catalog);
  const storage={getItem:()=>JSON.stringify(state),setItem:()=>assert.fail('must not write')};
  assert.equal(loadGame(storage,catalog).state,null);
  assert.throws(()=>saveGame(storage,state,catalog));
});
