import type { App } from '@/app';
import { CONFIRM_MS, PadGestures } from '@/input/padGestures';
import { h } from './dom';

/** What the pads do on one screen. Missing handlers make that gesture a no-op there. */
export interface PadNavTarget {
  prev?: () => void;
  next?: () => void;
  select?: () => void;
  back?: () => void;
  /** Names what select / back will do, for the "hit it again" prompt. */
  selectLabel?: () => string;
  backLabel?: string;
}

/** The visible label of a button, without key hints or descriptions. */
export function buttonLabel(el: HTMLElement): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('kbd, .hint').forEach((k) => k.remove());
  return c.textContent?.trim() ?? '';
}

/**
 * Wire the kit's pads to a screen (see src/input/padGestures.ts for the gestures). `target` is read
 * on every hit and may return null to make the pads inert (e.g. the game while not paused). Only MIDI
 * hits count: keyboard players have the arrow keys. Call `refresh` when `target`'s null-ness changes.
 */
export function attachPadNav(app: App, target: () => PadNavTarget | null): { dispose: () => void; refresh: () => void } {
  const gestures = new PadGestures();
  const prompt = h('div', { class: 'pad-prompt', hidden: true });
  const legend = h(
    'div',
    { class: 'pad-legend', hidden: true },
    h('span', { class: 'k' }, 'PADS'),
    h('span', null, h('b', null, '▲'), ' high tom'),
    h('span', null, h('b', null, '▼'), ' mid tom'),
    h('span', null, h('b', null, '●●'), ' floor tom select'),
    h('span', null, h('b', null, '●●'), ' crash back'),
  );
  document.body.append(prompt, legend);
  let promptTimer = 0;

  const refresh = () => {
    legend.hidden = !(app.settings.padNavigation && app.input.midi.ready && app.input.midi.ports().length && target());
  };
  const hidePrompt = () => {
    clearTimeout(promptTimer);
    prompt.hidden = true;
  };

  const unsubHits = app.input.onHit((hit) => {
    if (!hit.raw || !app.settings.padNavigation) return;
    const g = gestures.feed(hit.voice, hit.timeStamp);
    if (!g) return;
    const t = target();
    if (!t) return;
    if (g.kind === 'arm') {
      if (!t[g.action]) return;
      const what = g.action === 'select' ? t.selectLabel?.() : t.backLabel;
      prompt.replaceChildren(h('span', { class: 'k' }, g.action === 'select' ? 'FLOOR TOM' : 'CRASH'), ' again', what ? h('span', null, ' → ', h('b', null, what)) : '');
      prompt.hidden = false;
      clearTimeout(promptTimer);
      promptTimer = window.setTimeout(hidePrompt, CONFIRM_MS);
      return;
    }
    hidePrompt();
    t[g.action]?.();
  });
  const unsubPorts = app.input.midi.onPortsChanged(refresh);
  refresh();

  return {
    refresh,
    dispose: () => {
      unsubHits();
      unsubPorts();
      hidePrompt();
      prompt.remove();
      legend.remove();
    },
  };
}

/**
 * Pad focus over a list of buttons: prev/next move a ring, select clicks the ringed button. The first
 * move shows the ring on `preferred` (usually the primary action) rather than skipping past it.
 */
export function focusList(items: () => HTMLElement[], preferred?: () => HTMLElement | null | undefined): Required<Pick<PadNavTarget, 'prev' | 'next' | 'select' | 'selectLabel'>> {
  let current: HTMLElement | null = null;
  const usable = () => items().filter((el) => el.isConnected && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
  const start = (list: HTMLElement[]) => {
    const p = preferred?.();
    return p && list.includes(p) ? p : list[0];
  };
  const show = (el: HTMLElement) => {
    document.querySelectorAll('.pad-focus').forEach((e) => e.classList.remove('pad-focus'));
    current = el;
    el.classList.add('pad-focus');
    el.scrollIntoView({ block: 'nearest' });
  };
  const move = (step: number) => {
    const list = usable();
    if (!list.length) return;
    const i = current ? list.indexOf(current) : -1;
    if (i < 0) show(start(list));
    else show(list[Math.max(0, Math.min(list.length - 1, i + step))]);
  };
  const target = () => {
    const list = usable();
    return current && list.includes(current) ? current : list.length ? start(list) : null;
  };
  return {
    prev: () => move(-1),
    next: () => move(1),
    select: () => target()?.click(),
    selectLabel: () => {
      const t = target();
      return t ? buttonLabel(t) : '';
    },
  };
}
