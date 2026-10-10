export interface HandActions {
  select(id: string): void;
  move(id: string, position: number): void;
  dragging(active: boolean): void;
}

interface Gesture {
  source: HTMLButtonElement;
  kind: 'touch' | 'pointer';
  identifier: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  preview: HTMLButtonElement | null;
  destination: HTMLButtonElement | null;
}

// Keep click suppression across the render triggered by dropping a card.
const bindings = new WeakMap<HTMLElement, { dispose(): void; ignoreClickUntil: number }>();

export function wireHand(root: HTMLElement, ordering: boolean, actions: HandActions): void {
  const previous = bindings.get(root);
  previous?.dispose();
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const binding = { dispose, ignoreClickUntil: previous?.ignoreClickUntil ?? 0 };
  bindings.set(root, binding);
  let gesture: Gesture | null = null;
  const nativeTouch = 'ontouchstart' in window;

  function card(target: EventTarget | null): HTMLButtonElement | null {
    const button = target instanceof Element ? target.closest<HTMLButtonElement>('[data-card]') : null;
    return button && root.contains(button) && !button.disabled ? button : null;
  }

  function clear(): Gesture | null {
    const current = gesture;
    gesture = null;
    current?.source.classList.remove('is-dragging');
    current?.destination?.classList.remove('drop-target');
    current?.preview?.remove();
    return current;
  }

  function cancel(): void {
    if (clear()) {
      binding.ignoreClickUntil = Date.now() + 700;
      actions.dragging(false);
    }
  }

  function dispose(): void {
    controller.abort();
    cancel();
  }

  function begin(source: HTMLButtonElement, kind: Gesture['kind'], identifier: number, x: number, y: number): void {
    if (gesture) { cancel(); return; }
    const bounds = source.getBoundingClientRect();
    binding.ignoreClickUntil = 0;
    gesture = { source, kind, identifier, x, y, offsetX: x - bounds.left, offsetY: y - bounds.top,
      moved: false, preview: null, destination: null };
    actions.dragging(true);
  }

  function move(x: number, y: number): void {
    if (!gesture || (!gesture.moved && Math.hypot(x - gesture.x, y - gesture.y) < 6)) return;
    gesture.moved = true;
    if (!gesture.preview) {
      const preview = gesture.source.cloneNode(true) as HTMLButtonElement;
      const bounds = gesture.source.getBoundingClientRect();
      preview.removeAttribute('data-card');
      preview.removeAttribute('data-focus');
      preview.setAttribute('aria-hidden', 'true');
      preview.tabIndex = -1;
      preview.className = 'hand-card hand-drag-preview';
      preview.style.width = `${bounds.width}px`;
      preview.style.height = `${bounds.height}px`;
      document.body.append(preview);
      gesture.preview = preview;
      gesture.source.classList.add('is-dragging');
    }
    gesture.preview.style.transform = `translate3d(${x - gesture.offsetX}px, ${y - gesture.offsetY}px, 0)`;
    gesture.destination?.classList.remove('drop-target');
    gesture.destination = card(document.elementFromPoint(x, y));
    if (gesture.destination !== gesture.source) gesture.destination?.classList.add('drop-target');
  }

  function finish(x: number, y: number): void {
    move(x, y);
    const current = clear();
    if (!current) return;
    binding.ignoreClickUntil = Date.now() + 700;
    try {
      if (current.moved) {
        if (current.destination && current.destination !== current.source) {
          actions.move(current.source.dataset.card!, [...root.querySelectorAll('[data-card]')].indexOf(current.destination));
        }
      } else if (current.kind === 'touch') {
        // touchstart.preventDefault suppresses Safari's generated mouse click.
        actions.select(current.source.dataset.card!);
      } else {
        binding.ignoreClickUntil = 0;
      }
    } finally {
      actions.dragging(false);
    }
  }

  root.addEventListener('click', event => {
    const button = card(event.target);
    if (!button) return;
    if (ordering && event.detail > 0 && Date.now() < binding.ignoreClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    actions.select(button.dataset.card!);
  }, options);
  if (!ordering) return;

  root.addEventListener('keydown', event => {
    const button = card(event.target);
    if (!button || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    actions.move(button.dataset.card!, [...root.querySelectorAll('[data-card]')].indexOf(button) + (event.key === 'ArrowLeft' ? -1 : 1));
  }, options);
  root.addEventListener('contextmenu', event => { if (card(event.target)) event.preventDefault(); }, options);

  root.addEventListener('touchstart', event => {
    if (gesture) { event.preventDefault(); cancel(); return; }
    const source = card(event.target);
    const touch = event.changedTouches[0];
    if (!source || !touch || event.touches.length !== 1) return;
    event.preventDefault();
    begin(source, 'touch', touch.identifier, touch.clientX, touch.clientY);
  }, { ...options, passive: false });
  document.addEventListener('touchstart', event => {
    if (gesture?.kind === 'touch' && event.touches.length !== 1) cancel();
  }, options);
  document.addEventListener('touchmove', event => {
    if (gesture?.kind !== 'touch') return;
    event.preventDefault();
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = [...event.changedTouches].find(touch => touch.identifier === gesture!.identifier);
    if (touch) move(touch.clientX, touch.clientY);
  }, { ...options, passive: false });
  document.addEventListener('touchend', event => {
    if (gesture?.kind !== 'touch') return;
    const touch = [...event.changedTouches].find(touch => touch.identifier === gesture!.identifier);
    if (!touch) return;
    event.preventDefault();
    finish(touch.clientX, touch.clientY);
  }, { ...options, passive: false });
  document.addEventListener('touchcancel', event => {
    if (gesture?.kind === 'touch' && [...event.changedTouches].some(touch => touch.identifier === gesture!.identifier)) cancel();
  }, options);

  // Mouse, pen and browsers using Pointer Events alone track the whole document.
  // Moving a card must not depend on setPointerCapture being available.
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (nativeTouch && event.pointerType === 'touch')) return;
    const source = card(event.target);
    if (source) begin(source, 'pointer', event.pointerId, event.clientX, event.clientY);
  }, options);
  document.addEventListener('pointermove', event => {
    if (gesture?.kind !== 'pointer' || event.pointerId !== gesture.identifier) return;
    event.preventDefault();
    move(event.clientX, event.clientY);
  }, { ...options, passive: false });
  document.addEventListener('pointerup', event => {
    if (gesture?.kind === 'pointer' && event.pointerId === gesture.identifier) finish(event.clientX, event.clientY);
  }, options);
  document.addEventListener('pointercancel', event => {
    if (gesture?.kind === 'pointer' && event.pointerId === gesture.identifier) cancel();
  }, options);
  window.addEventListener('blur', cancel, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
}
