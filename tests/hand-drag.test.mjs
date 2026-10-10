import nodeTest from 'node:test';
import { setMaxListeners } from 'node:events';
import assert from 'node:assert/strict';
import { wireHand } from '../public/app/ui/hand-drag.js';

setMaxListeners(20);

// Node 16's test runner has no TestContext.after yet.
function test(name, body) {
  nodeTest(name, () => {
    let cleanup;
    try { body({ after: action => { cleanup = action; } }); }
    finally { cleanup?.(); }
  });
}

// Minimal event/geometry fixture: cards deliberately have no Pointer Capture API.
class Card extends EventTarget {
  constructor(id, index) {
    super();
    this.dataset = { card: id };
    this.index = index;
    this.style = {};
    this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
  }
  closest() { return this; }
  getBoundingClientRect() { return { left: this.index * 60, top: 0, width: 50, height: 70 }; }
  cloneNode() { return new Card(this.dataset.card, this.index); }
  removeAttribute(name) { if (name === 'data-card') delete this.dataset.card; }
  setAttribute() {}
  remove() { this.removed = true; }
}

function fixture(t, ordering = true, nativeTouch = true) {
  const originals = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
  const document = new EventTarget();
  const window = new EventTarget();
  if (nativeTouch) window.ontouchstart = null;
  const root = new EventTarget();
  const cards = [new Card('a', 0), new Card('b', 1), new Card('c', 2)];
  root.contains = node => cards.includes(node);
  root.querySelectorAll = () => cards;
  const previews = [];
  document.body = { append: preview => previews.push(preview) };
  document.elementFromPoint = (x, y) => cards.find(card => x >= card.index * 60 && x < card.index * 60 + 50 && y >= 0 && y < 70) ?? null;
  Object.assign(globalThis, { document, window, Element: Card });
  const moves = [], selections = [], dragging = [];
  const actions = { move: (...args) => moves.push(args), select: id => selections.push(id), dragging: active => dragging.push(active) };
  wireHand(root, ordering, actions);
  t.after(() => { wireHand(root, false, actions); Object.assign(globalThis, originals); });
  const emit = (target, type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    for (const [name, value] of Object.entries(properties)) Object.defineProperty(event, name, { value });
    target.dispatchEvent(event);
    return event;
  };
  const touch = (x, y = 35, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  const start = () => emit(root, 'touchstart', { target: cards[0], touches: [touch(25)], changedTouches: [touch(25)] });
  const end = (x, y = 35) => emit(document, 'touchend', { touches: [], changedTouches: [touch(x, y)] });
  return { root, cards, document, window, actions, moves, selections, dragging, previews, emit, touch, start, end };
}

test('a finger drag moves a card without Pointer Capture, follows the finger and suppresses the click after rendering', t => {
  const f = fixture(t);
  assert(f.start().defaultPrevented);
  const move = f.emit(f.document, 'touchmove', { touches: [f.touch(85)], changedTouches: [f.touch(85)] });
  assert(move.defaultPrevented);
  assert.equal(f.previews[0].style.transform, 'translate3d(60px, 0px, 0)');
  assert(f.cards[1].classes.has('drop-target'));
  // The final touch position, rather than the previous move, determines the slot.
  f.end(145);
  assert.deepEqual(f.moves, [['a', 2]]);
  assert.deepEqual(f.dragging, [true, false]);
  assert(f.previews[0].removed);
  assert(!f.cards.some(card => card.classes.size));
  wireHand(f.root, true, f.actions);
  const click = f.emit(f.root, 'click', { target: f.cards[2], detail: 1 });
  assert(click.defaultPrevented);
  assert.deepEqual(f.selections, []);
});

test('a touch tap selects exactly once; a subsequent touch is not blocked', t => {
  const f = fixture(t);
  f.start(); f.end(27);
  f.emit(f.root, 'click', { target: f.cards[0], detail: 1 });
  assert.deepEqual(f.selections, ['a']);
  f.start(); f.end(25);
  assert.deepEqual(f.selections, ['a', 'a']);
  assert.deepEqual(f.moves, []);
});

test('cancellation, dropping outside the hand and adding another finger leave the order unchanged', t => {
  const f = fixture(t);
  f.start(); f.end(300);
  f.start();
  f.emit(f.document, 'touchmove', { touches: [f.touch(85)], changedTouches: [f.touch(85)] });
  f.emit(f.document, 'touchcancel', { changedTouches: [f.touch(85)] });
  f.start();
  f.emit(f.root, 'touchstart', { target: f.cards[1], touches: [f.touch(25), f.touch(85, 35, 2)], changedTouches: [f.touch(85, 35, 2)] });
  f.end(145);
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.selections, []);
  assert.deepEqual(f.dragging, [true, false, true, false, true, false]);
  assert(f.previews.every(preview => preview.removed));
});

test('rendering or hiding the app cleans up an active drag and resumes the bot', t => {
  const f = fixture(t);
  f.start();
  f.emit(f.document, 'touchmove', { touches: [f.touch(85)], changedTouches: [f.touch(85)] });
  wireHand(f.root, true, f.actions);
  assert(f.previews[0].removed);
  f.start();
  f.document.hidden = true;
  f.emit(f.document, 'visibilitychange');
  f.end(145);
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.dragging, [true, false, true, false]);
});

test('mouse and pointer-only touch drags work on document listeners; keyboard movement still works', t => {
  const f = fixture(t, true, false);
  for (const pointerType of ['mouse', 'touch']) {
    f.emit(f.root, 'pointerdown', { target: f.cards[0], button: 0, pointerId: 7, pointerType, clientX: 25, clientY: 35 });
    f.emit(f.document, 'pointermove', { pointerId: 8, clientX: 145, clientY: 35 });
    f.emit(f.document, 'pointerup', { pointerId: 7, clientX: 85, clientY: 35 });
  }
  f.emit(f.root, 'keydown', { target: f.cards[1], key: 'ArrowRight' });
  f.emit(f.root, 'click', { target: f.cards[1], detail: 0 });
  assert.deepEqual(f.moves, [['a', 1], ['a', 1], ['b', 2]]);
  assert.deepEqual(f.selections, ['b']);
});

test('outside ordering mode, card taps keep the normal selection and page scrolling', t => {
  const f = fixture(t, false);
  assert(!f.start().defaultPrevented);
  f.emit(f.root, 'click', { target: f.cards[0], detail: 1 });
  assert.deepEqual(f.selections, ['a']);
  assert.deepEqual(f.dragging, []);
});
