import type { App, Screen } from '@/app';
import { DRUM_VOICES, VOICE_LABELS, type DrumVoice } from '@/types';
import { h, button, field, select, toast, clear, downloadBlob, pickFile, fmtAgo } from './dom';
import { openCamera, videoRecordingSupported } from '@/game/videoRecorder';
import { topbar } from './topbar';
import { VOICE_COLORS } from '@/game/renderer';
import { hitWindowsFor } from '@/game/scoring';
import { DIFFICULTIES, LANE_LABELS, type Lane, type RenderScale } from '@/types';
import { LANE_COLORS } from '@/game/renderer';
import { Metronome, Transport } from '@/audio';

type SettingsTab = 'timing' | 'audio' | 'lanes' | 'video' | 'data';
const TABS: { id: SettingsTab; label: string; hint: string }[] = [
  { id: 'timing', label: 'TIMING', hint: 'calibration, hit windows' },
  { id: 'audio', label: 'SOUND & SCREEN', hint: 'volumes, motion, resolution' },
  { id: 'lanes', label: 'LANES & KEYS', hint: 'highway order, keyboard' },
  { id: 'video', label: 'VIDEO', hint: 'record your takes' },
  { id: 'data', label: 'PROFILE & DATA', hint: 'name, scores, devices' },
];

export function settingsScreen(app: App, params?: Record<string, unknown>): Screen {
  const s = app.settings;
  let tab: SettingsTab = (params?.tab as SettingsTab) ?? (localStorage.getItem('dk.settingsTab') as SettingsTab | null) ?? 'timing';
  if (!TABS.some((t) => t.id === tab)) tab = 'timing';
  const num = (v: number, step: number, min: number, max: number, onChange: (n: number) => void) => {
    const input = h('input', { class: 'input', type: 'number', step, min, max, value: v, onChange: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)) });
    return input;
  };
  const range = (v: number, min: number, max: number, step: number, onInput: (n: number) => void) => {
    const label = h('span', { class: 'mono small', style: { minWidth: '52px', display: 'inline-block' } }, fmt(v));
    const input = h('input', { class: 'input', type: 'range', min, max, step, value: v, style: { flex: 1 }, onInput: (e: Event) => { const n = Number((e.target as HTMLInputElement).value); label.textContent = fmt(n); onInput(n); } });
    function fmt(n: number): string { return max <= 1 ? `${Math.round(n * 100)}%` : `${n}`; }
    return h('div', { class: 'row' }, input, label);
  };

  const offsetInput = num(Math.round(s.inputOffset * 1000), 1, -500, 500, (ms) => app.settingsStore.update({ inputOffset: ms / 1000 }));
  const windowsTable = h('div', { class: 'small mono dim' });
  function renderWindows(): void {
    const sc = app.settings.hitWindowScale;
    windowsTable.textContent = DIFFICULTIES.map((d) => { const w = hitWindowsFor(d, sc); return `${d}: ±${Math.round(w.perfect * 1000)} / ±${Math.round(w.great * 1000)} / ±${Math.round(w.good * 1000)} ms`; }).join('   ·   ');
  }
  renderWindows();

  // lane order editor
  const laneEditor = h('div', { class: 'lane-editor' });
  function renderLanes(): void {
    clear(laneEditor);
    const order = app.settings.laneOrder;
    order.forEach((lane, i) => {
      const move = (dir: number) => {
        const next = [...order];
        const j = i + dir;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        app.settingsStore.update({ laneOrder: next });
        renderLanes();
      };
      laneEditor.appendChild(h('div', { class: 'lane-chip', style: { '--c': LANE_COLORS[lane] } },
        button('◀', () => move(-1), 'icon ghost small'),
        h('span', { class: 'lane-name' }, LANE_LABELS[lane]),
        button('▶', () => move(1), 'icon ghost small'),
      ));
    });
    laneEditor.appendChild(h('div', { class: 'small mute', style: { flexBasis: '100%', marginTop: '6px' } }, 'Crash always spans the full width. Presets:'));
    const presets: [string, Lane[]][] = [
      ['DRUM KIT (DEFAULT)', ['hihat', 'snare', 'kick', 'toms', 'ride']],
      ['KICK FIRST', ['kick', 'hihat', 'snare', 'toms', 'ride']],
      ['MIRRORED', ['ride', 'toms', 'kick', 'snare', 'hihat']],
    ];
    laneEditor.appendChild(h('div', { class: 'btn-row', style: { flexBasis: '100%' } }, ...presets.map(([label, o]) => button(label, () => { app.settingsStore.update({ laneOrder: o }); renderLanes(); }, 'icon small'))));
  }
  renderLanes();

  // keyboard binding editor
  const keys = h('div', { class: 'voice-list' });
  function renderKeys(): void {
    clear(keys);
    const kb = app.settings.keyboard;
    for (const voice of DRUM_VOICES) {
      const chip = h('div', { class: 'voice-chip', style: { '--v': VOICE_COLORS[voice] } },
        h('div', { class: 'name' }, VOICE_LABELS[voice]),
        h('div', { class: 'pads' }, (kb[voice] ?? []).map((c) => c.replace('Key', '').replace('Digit', '')).join(' · ') || '—'),
        h('div', { class: 'btn-row tight' }, button('SET', () => captureKey(voice), 'icon small'), button('CLEAR', () => { app.settingsStore.update({ keyboard: { ...app.settings.keyboard, [voice]: [] } }); renderKeys(); }, 'icon ghost small')),
      );
      keys.appendChild(chip);
    }
  }
  function captureKey(voice: DrumVoice): void {
    toast(`Press a key for ${VOICE_LABELS[voice]}…`);
    app.input.keyboard.setEnabled(false);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      window.removeEventListener('keydown', handler, true);
      app.input.keyboard.setEnabled(true);
      if (e.code === 'Escape') return;
      const kb = { ...app.settings.keyboard };
      for (const v of DRUM_VOICES) kb[v] = (kb[v] ?? []).filter((c) => c !== e.code);
      kb[voice] = [...(kb[voice] ?? []), e.code];
      app.settingsStore.update({ keyboard: kb });
      renderKeys();
    };
    window.addEventListener('keydown', handler, true);
  }
  renderKeys();

  // latency calibration
  const calib = h('div', { class: 'panel tight' });
  function renderCalib(result?: { mean: number; n: number }): void {
    clear(calib);
    const at = Number(localStorage.getItem('dk.calibratedAt')) || 0;
    calib.append(
      h('h3', { style: { marginTop: 0 } }, 'Latency calibration'),
      h('div', { class: 'small dim' }, 'Plays 12 clicks at 120 BPM. Hit any pad (or key) exactly on each click. We measure the average delay and set the input offset for you. Re-run whenever you change speakers, headphones or cables.'),
      h('div', { class: 'row', style: { marginTop: '10px', gap: '10px' } },
        button('RUN CALIBRATION', runCalibration, 'primary'),
        result
          ? h('span', { class: 'pill ok' }, `hits averaged ${(result.mean * 1000).toFixed(0)} ms over ${result.n} clicks`)
          : at ? h('span', { class: 'small dim' }, `Last run ${fmtAgo(at)}`) : h('span', { class: 'pill warn' }, 'Not run yet'),
      ),
    );
  }
  async function runCalibration(): Promise<void> {
    await app.boot();
    const ctx = app.engine.ctx;
    const bpm = 120;
    const beat = 60 / bpm;
    const clicks = 12;
    const silent = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (beat * (clicks + 2))), ctx.sampleRate);
    const t = new Transport(app.engine);
    t.load(silent);
    const m = new Metronome(app.engine, t);
    m.setTempoMap([{ tick: 0, time: 0, bpm }], 480, [{ tick: 0, numerator: 4, denominator: 4 }]);
    m.setOffset(beat); // first click at 1 beat in
    await m.prepare();
    const deltas: number[] = [];
    let received = 0;
    let fallbacks = 0;
    const unsub = app.input.onHit((hit) => {
      received++;
      if (hit.raw && app.input.midi.fallbackCount) fallbacks = app.input.midi.fallbackCount;
      const pos = t.positionAtPerfTime(hit.timeStamp) - beat - app.engine.inputLatencyCompensation;
      const nearest = Math.round(pos / beat) * beat;
      const d = pos - nearest;
      // Accept anything near a click (the click grid runs from 0 to clicks-1 beats; allow one beat of slack).
      if (nearest >= -beat && nearest <= beat * clicks) deltas.push(d);
    });
    toast('Calibrating… hit along with the clicks');
    t.play(0);
    m.start();
    await new Promise((r) => setTimeout(r, beat * (clicks + 1.5) * 1000));
    m.stop();
    t.stop();
    unsub();
    if (deltas.length < 4) {
      toast(received ? `Received ${received} hits but only ${deltas.length} lined up with the clicks — timestamps look off (MIDI monitor in Pad Setup shows the skew).` : 'No hits registered. Check Pad Setup / MIDI connection.', 'bad', 6000);
      renderCalib();
      return;
    }
    deltas.sort((a, b) => a - b);
    const trimmed = deltas.slice(1, -1);
    const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    // player hits late by `mean` → subtract it from their timing
    app.settingsStore.update({ inputOffset: -mean });
    localStorage.setItem('dk.calibratedAt', String(Date.now()));
    offsetInput.value = String(Math.round(-mean * 1000));
    renderCalib({ mean, n: deltas.length });
    toast(`Input offset set to ${Math.round(-mean * 1000)} ms (${deltas.length}/${received} hits used${fallbacks ? ', hardware timestamps ignored' : ''})`, 'ok', 5000);
  }
  renderCalib();

  // performance video recording
  const camSelect = select([{ value: '', label: 'Default camera' }], s.recordCameraId ?? '', (v) => app.settingsStore.update({ recordCameraId: v || undefined }));
  async function listCameras(requestPermission: boolean): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    if (requestPermission) {
      // Labels are only revealed once the page has camera permission.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch (e) {
        toast(`Camera permission denied (${(e as Error).name})`, 'bad');
        return;
      }
    }
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    clear(camSelect);
    camSelect.appendChild(h('option', { value: '' }, 'Default camera'));
    cams.forEach((c, i) => camSelect.appendChild(h('option', { value: c.deviceId, selected: c.deviceId === app.settings.recordCameraId }, c.label || `Camera ${i + 1}`)));
    if (requestPermission) toast(cams.length ? `${cams.length} camera${cams.length === 1 ? '' : 's'} found` : 'No cameras found', cams.length ? 'ok' : 'bad');
  }
  void listCameras(false);
  const camTest = h('div', { class: 'cam-test' });
  let testStream: MediaStream | null = null;
  function stopCamTest(): void {
    testStream?.getTracks().forEach((t) => t.stop());
    testStream = null;
    clear(camTest);
    testBtn.textContent = 'TEST CAMERA';
  }
  const testBtn = button('TEST CAMERA', async () => {
    if (testStream) return stopCamTest();
    try {
      testStream = await openCamera(app.settings.recordCameraId, false);
      const v = h('video', { autoplay: true, muted: true, playsInline: true, class: app.settings.recordRotate ? 'rotated' : '' });
      v.srcObject = testStream;
      camTest.appendChild(v);
      testBtn.textContent = 'STOP TEST';
      void listCameras(false);
    } catch (e) {
      toast(`Camera unavailable (${(e as Error).name})`, 'bad');
    }
  });
  const videoPanel = videoRecordingSupported()
    ? [
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.recordVideo, onChange: (e: Event) => app.settingsStore.update({ recordVideo: (e.target as HTMLInputElement).checked }) }), 'Record my performances — you on the left, the highway on the right, side by side; the video is offered on the results screen'),
        h('div', { class: 'small mute', style: { margin: '6px 0 12px' } }, 'Recorded in the browser as WebM; nothing is uploaded. Play and practice modes only. Costs some CPU — use 720p on laptops.'),
        field('Camera', h('div', { class: 'row' }, camSelect, button('DETECT', () => listCameras(true), 'icon small'), testBtn)),
        camTest,
        field('Video size', select([{ value: '720', label: '1280 × 720 (recommended)' }, { value: '1080', label: '1920 × 1080' }], String(s.recordResolution), (v) => app.settingsStore.update({ recordResolution: Number(v) as 720 | 1080 }))),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.recordMic, onChange: (e: Event) => app.settingsStore.update({ recordMic: (e.target as HTMLInputElement).checked }) }), 'Also record the microphone (raw — picks up your pads, and whatever your speakers play)'),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.recordRotate, onChange: (e: Event) => {
          const rotate = (e.target as HTMLInputElement).checked;
          app.settingsStore.update({ recordRotate: rotate });
          camTest.querySelector('video')?.classList.toggle('rotated', rotate);
        } }), 'Rotate the camera 180° (for a webcam mounted upside down over the pads)'),
      ]
    : [h('div', { class: 'small dim' }, 'This browser cannot record video (needs MediaRecorder, canvas capture and camera access). Try Chrome, Edge or Firefox.')];

  const toggle = (checked: boolean, label: string, onChange: (on: boolean) => void) =>
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked, onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }), label);

  const sections: Record<SettingsTab, HTMLElement[]> = {
    timing: [
      calib,
      h('h3', null, 'Input offset'),
      field('Offset (ms)', offsetInput, 'Positive = your hits are judged earlier. Negative = later. Calibration sets this for you; in-game, [ and ] nudge it by 10 ms.'),
      h('h3', null, 'How forgiving'),
      field('Hit window size', range(s.hitWindowScale, 0.5, 3, 0.05, (v) => { app.settingsStore.update({ hitWindowScale: v }); renderWindows(); }), '1.0 = arcade-tight. Bigger = more forgiving. Applies to perfect / great / good equally.'),
      h('div', { class: 'btn-row', style: { margin: '0 0 8px' } }, ...[['TIGHT', 1], ['NORMAL', 1.5], ['LOOSE', 2.2], ['VERY LOOSE', 3]].map(([label, v]) => button(String(label), () => { app.settingsStore.update({ hitWindowScale: Number(v) }); app.navigate('settings'); }, 'icon small'))),
      windowsTable,
      h('div', { style: { height: '14px' } }),
      toggle(s.strictVoices, 'Strict drums on hard/expert (open vs closed hat, which tom). Off = any drum on the same lane counts.', (on) => app.settingsStore.update({ strictVoices: on })),
      h('h3', null, 'Highway speed'),
      field('Seconds of highway visible', range(s.scrollWindow, 0.8, 3, 0.1, (v) => app.settingsStore.update({ scrollWindow: v })), 'Shorter = notes move faster and sit closer together.'),
    ],
    audio: [
      h('h3', { style: { marginTop: 0 } }, 'Volume'),
      field('Song volume', range(s.songVolume, 0, 1, 0.01, (v) => app.settingsStore.update({ songVolume: v }))),
      field('Drum volume', range(s.drumVolume, 0, 1, 0.01, (v) => app.settingsStore.update({ drumVolume: v }))),
      toggle(s.drumSoundsOnHit, 'Play drum samples when I hit a pad (turn off if your module makes its own sound, e.g. the TD-07 with Local Control on)', (on) => app.settingsStore.update({ drumSoundsOnHit: on })),
      h('h3', null, 'Screen'),
      toggle(s.reducedMotion, 'Reduced motion (no shake / particles)', (on) => app.settingsStore.update({ reducedMotion: on })),
      h('div', { style: { height: '12px' } }),
      field(
        'Highway resolution',
        select(
          [
            { value: '2', label: '2× (full Retina)' },
            { value: '1.5', label: '1.5× (about half the pixels)' },
            { value: '1', label: '1× (lightest)' },
          ],
          String(s.renderScale),
          (v) => app.settingsStore.update({ renderScale: Number(v) as RenderScale }),
        ),
        'Lower this if the highway stutters on a Retina display. Takes effect on the next song.',
      ),
    ],
    lanes: [
      h('h3', { style: { marginTop: 0 } }, 'Highway lanes (left → right)'),
      h('div', { class: 'small dim', style: { marginBottom: '10px' } }, 'Arrange the drums to match how your pads are laid out.'),
      laneEditor,
      h('h3', null, 'Keyboard fallback'),
      h('div', { class: 'small dim', style: { marginBottom: '10px' } }, 'No pads handy? Play with the keyboard. Click SET then press a key (Esc cancels).'),
      keys,
    ],
    video: [h('h3', { style: { marginTop: 0 } }, 'Performance video'), ...videoPanel],
    data: [
      h('h3', { style: { marginTop: 0 } }, 'Player'),
      field('Name (for high scores)', h('input', { class: 'input', value: s.playerName, maxLength: 16, onChange: (e: Event) => app.settingsStore.update({ playerName: (e.target as HTMLInputElement).value.trim().toUpperCase() || 'PLAYER' }) })),
      h('h3', null, 'Scores'),
      h('div', { class: 'btn-row' },
        button('EXPORT SCORES', () => downloadBlob(new Blob([app.scores.exportJson()], { type: 'application/json' }), 'woodshed-scores.json')),
        button('IMPORT SCORES', async () => { const [f] = await pickFile('.json'); if (!f) return; const r = app.scores.importJson(await f.text()); toast(`Imported ${r.imported} scores`, 'ok'); }),
        button('RESET ALL SCORES', () => { if (confirm('Delete ALL high scores?')) { app.scores.clear(); toast('Scores cleared'); } }, 'danger'),
      ),
      h('h3', null, 'Saved pad setups'),
      h('div', { class: 'small dim' }, app.devices.list().length ? app.devices.list().map((d) => h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'pill' }, d.deviceName), h('span', { class: 'mute' }, `${Object.values(d.bindings).flat().length} pads`), button('DELETE', () => { app.devices.remove(d.deviceKey); app.navigate('settings'); }, 'icon ghost small'))) : 'No saved pad setups yet.'),
      h('h3', null, 'Start over'),
      h('div', { class: 'btn-row' }, button('RESET SETTINGS', () => { if (confirm('Reset every setting to its default (including input offset)?')) { app.settingsStore.reset(); app.navigate('settings'); } }, 'danger')),
    ],
  };

  const tabBar = h('div', { class: 'tabs settings-tabs' });
  const pane = h('div', { class: 'panel settings-pane' });
  function showTab(next: SettingsTab): void {
    if (tab === 'video' && next !== 'video') stopCamTest();
    tab = next;
    localStorage.setItem('dk.settingsTab', tab);
    tabBar.replaceChildren(...TABS.map((t) => h('div', { class: `tab ${t.id === tab ? 'active' : ''}`, role: 'tab', tabIndex: 0, onClick: () => showTab(t.id), onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') showTab(t.id); } }, h('span', { class: 'label' }, t.label), h('span', { class: 'hint' }, t.hint))));
    pane.replaceChildren(...sections[tab]);
  }
  showTab(tab);

  const el = h(
    'div',
    { class: 'screen' },
    topbar(app, 'SETTINGS', button('BACK', () => app.navigate('title'), 'ghost')),
    h('div', { class: 'screen-body' }, h('div', { class: 'settings-wrap' }, tabBar, pane)),
  );
  return { el, dispose: stopCamTest };
}
