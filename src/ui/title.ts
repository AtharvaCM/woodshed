import type { App, Screen } from '@/app';
import { typingInField } from '@/app';
import { DRUM_VOICES, VOICE_LABELS, type Difficulty, type SongListEntry } from '@/types';
import { h, button, clear, fmtAgo, pct, toast } from './dom';
import { attachPadNav, focusList } from './padNav';

/** One line of the "ready to play?" checklist: a status dot, what it is, and what to do about it. */
function checkRow(state: 'ok' | 'warn' | 'bad' | 'idle', label: string, detail: string, action?: { label: string; run: () => void }): HTMLElement {
  return h(
    'div',
    { class: `check ${state}` },
    h('span', { class: 'dot' }),
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' }, detail),
    action ? button(action.label, action.run, 'icon small ghost') : h('span'),
  );
}

export function titleScreen(app: App): Screen {
  const checks = h('div', { class: 'checks panel tight' });
  const resume = h('div', { class: 'resume-slot' });

  const refreshChecks = () => {
    clear(checks);
    const midi = app.input.midi;
    // Kit connection
    if (!midi.supported) checks.appendChild(checkRow('bad', 'KIT', 'No Web MIDI in this browser — use Chrome or Edge. Keyboard still works.'));
    else if (!midi.ready) checks.appendChild(checkRow('idle', 'KIT', 'Not connected yet', { label: 'CONNECT', run: connect }));
    else {
      const ports = midi.ports();
      if (!ports.length) checks.appendChild(checkRow('warn', 'KIT', midi.error ? `${midi.error}` : 'No MIDI device — power on the module and plug in USB'));
      else {
        const name = midi.activePort?.name ?? ports[0].name;
        checks.appendChild(checkRow('ok', 'KIT', `${name}${ports.length > 1 ? ` (+${ports.length - 1} more)` : ''}`));
        // Pad map for the active device
        const cfg = app.devices.get(name);
        const unmapped = DRUM_VOICES.filter((v) => !(cfg?.bindings[v] ?? []).length);
        const pads = cfg ? Object.values(cfg.bindings).flat().length : 0;
        checks.appendChild(
          unmapped.length
            ? checkRow('warn', 'PADS', `${unmapped.map((v) => VOICE_LABELS[v]).join(', ')} not mapped`, { label: 'PAD SETUP', run: () => go('wizard') })
            : checkRow('ok', 'PADS', `${pads} pads mapped to all 9 drums`, { label: 'EDIT', run: () => go('wizard') }),
        );
      }
    }
    // Latency calibration
    const offsetMs = Math.round(app.settings.inputOffset * 1000);
    const calibratedAt = Number(localStorage.getItem('dk.calibratedAt')) || 0;
    const calibrate = { label: calibratedAt ? 'RE-RUN' : 'CALIBRATE', run: () => go('settings', { tab: 'timing' }) };
    if (calibratedAt) checks.appendChild(checkRow('ok', 'TIMING', `Offset ${offsetMs > 0 ? '+' : ''}${offsetMs} ms · calibrated ${fmtAgo(calibratedAt)}`, calibrate));
    else if (offsetMs) checks.appendChild(checkRow('ok', 'TIMING', `Offset ${offsetMs > 0 ? '+' : ''}${offsetMs} ms (set by hand)`, calibrate));
    else checks.appendChild(checkRow('warn', 'TIMING', 'Not calibrated — hits may be judged early or late', calibrate));
  };

  async function connect(): Promise<void> {
    await app.boot();
    refreshChecks();
    pads.refresh();
    if (app.input.midi.ready && !app.input.midi.ports().length) toast('MIDI is on, but no device is plugged in', 'bad');
  }

  refreshChecks();
  const unsub = app.input.midi.onPortsChanged(refreshChecks);

  async function go(name: string, params?: Record<string, unknown>): Promise<void> {
    await app.boot();
    app.navigate(name, params);
  }

  // "Pick up where you left off": the last song played, straight back into the same mode.
  let lastEntry: SongListEntry | null = null;
  const lastId = localStorage.getItem('dk.lastSong');
  const lastMode = localStorage.getItem('dk.lastMode') === 'practice' ? 'practice' : 'play';
  const lastDiff = (localStorage.getItem('dk.lastDifficulty') as Difficulty | null) ?? 'medium';
  const rate = Number(localStorage.getItem('dk.practiceRate') ?? 1) || 1;
  async function resumeLast(mode: 'play' | 'practice'): Promise<void> {
    if (!lastEntry) return;
    await app.boot();
    try {
      const pkg = await app.library.load(lastEntry);
      app.navigate('game', { pkg, difficulty: lastDiff, mode });
    } catch (err) {
      toast(`Could not load song: ${(err as Error).message}`, 'bad');
    }
  }
  if (lastId) {
    app.library.listAll().then((entries) => {
      lastEntry = entries.find((e) => e.meta.id === lastId) ?? null;
      if (!lastEntry) return;
      const best = app.scores.getBest(lastEntry.meta.id, lastDiff);
      resume.replaceChildren(
        h(
          'div',
          { class: 'resume panel tight', style: { '--sa': lastEntry.meta.accent ?? '' } },
          h(
            'div',
            { class: 'who' },
            h('div', { class: 'k' }, 'PICK UP WHERE YOU LEFT OFF'),
            h('div', { class: 't' }, lastEntry.meta.title),
            h('div', { class: 'small dim' }, `${lastEntry.meta.artist} · ${lastDiff.toUpperCase()}${best ? ` · best ${pct(best.accuracy)}` : ''}`),
          ),
          h(
            'div',
            { class: 'btn-row' },
            button(`PRACTICE ${Math.round(rate * 100)}%`, () => resumeLast('practice'), lastMode === 'practice' ? 'primary' : ''),
            button('PLAY', () => resumeLast('play'), lastMode === 'play' ? 'primary' : ''),
          ),
        ),
      );
    });
  }

  const menuItem = (label: string, hint: string, name: string, key: string, cls = '') =>
    button([h('span', null, h('kbd', null, key), ' ', label), h('span', { class: 'hint' }, hint)], () => go(name), cls);

  const onKey = (e: KeyboardEvent) => {
    if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-back')) return;
    const target = ({ Digit1: 'songs', Digit2: 'songs-practice', Digit3: 'studio', Digit4: 'wizard', Digit5: 'settings' } as Record<string, string>)[e.code];
    if (target) {
      e.preventDefault();
      go(target);
    } else if (e.code === 'Enter' && lastEntry && document.activeElement === document.body) {
      e.preventDefault();
      resumeLast(lastMode);
    }
  };
  window.addEventListener('keydown', onKey);

  // Pads: ▲▼ move through the resume card and the menu, floor tom ×2 opens the ringed item.
  const menuFocus = focusList(
    () => Array.from(el.querySelectorAll<HTMLElement>('.resume .btn, .menu .btn')),
    () => el.querySelector<HTMLElement>('.resume .btn.primary') ?? el.querySelector<HTMLElement>('.menu .btn.primary'),
  );
  const pads = attachPadNav(app, () => menuFocus);

  const el = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'screen-body center' },
      h(
        'div',
        { class: 'title-wrap' },
        h('h1', { class: 'logo' }, h('span', { class: 'a' }, 'WOODSHED'), h('span', { class: 'b' }, 'E-DRUM PRACTICE ROOM')),
        h('div', { class: 'tagline' }, 'plug in the kit · loop the hard bars · own the song'),
        resume,
        h(
          'div',
          { class: 'menu' },
          menuItem('PLAY', 'pick a song, chase the high score', 'songs', '1', 'primary'),
          menuItem('PRACTICE', 'slow it down, loop the hard bars', 'songs-practice', '2'),
          menuItem('STUDIO', 'make a song, record or fix its chart', 'studio', '3'),
          menuItem('PAD SETUP', 'map your pads to each drum', 'wizard', '4'),
          menuItem('SETTINGS', 'calibration, volumes, lanes, video', 'settings', '5'),
        ),
        checks,
        h('div', { class: 'small mute' }, 'No kit handy? Keys: ', h('kbd', null, 'D'), ' hat ', h('kbd', null, 'F'), ' snare ', h('kbd', null, 'Space'), ' kick — the rest in Settings. Chrome or Edge required (Web MIDI).'),
      ),
    ),
  );
  return {
    el,
    dispose: () => {
      unsub();
      pads.dispose();
      window.removeEventListener('keydown', onKey);
    },
  };
}
