import type { App, Screen } from '@/app';
import type { Chart, Difficulty, ScoreSummary, SongPackage, SongSection } from '@/types';
import { DIFFICULTIES, DRUM_VOICES } from '@/types';
import { chartFromMidi, deriveDifficulty, parseMidi, constantTempoMap, DEFAULT_PPQ, buildSongMap, proposeSections } from '@/midi';
import { getChartBlob } from '@/song';
import { GameSession, computeBeats, type GameMode } from '@/game/session';
import { barAt, barSpan, barStarts, type BarNote } from '@/game/bars';
import { typingInField } from '@/app';
import { attachPadNav, focusList } from './padNav';
import { CAM_ASPECT, VideoRecorder, openCamera, videoRecordingSupported, type HudSnapshot, type RecordedVideo } from '@/game/videoRecorder';
import { hitWindowsFor, starString, verdictFor } from '@/game/scoring';
import { h, button, toast, fmtScore } from './dom';
import type { TimingHit } from '@/game/timingHeatmap';

/** Parse the chart file listed for `difficulty`, or null when the package has none. */
export async function readChart(pkg: SongPackage, difficulty: Difficulty): Promise<Chart | null> {
  const blob = getChartBlob(pkg, difficulty);
  if (!blob) return null;
  return chartFromMidi(parseMidi(await blob.arrayBuffer()), { fallbackBpm: pkg.meta.bpm });
}

/** Difficulties whose chart file exists AND contains notes, easy→expert. An empty MIDI counts as no chart. */
export async function realDifficulties(pkg: SongPackage): Promise<Difficulty[]> {
  const out: Difficulty[] = [];
  for (const d of DIFFICULTIES) {
    const c = await readChart(pkg, d).catch(() => null);
    if (c?.notes.length) out.push(d);
  }
  return out;
}

/** Load (or derive) the chart for a difficulty from a song package. A chart file with no notes is treated as missing. */
export async function loadChart(pkg: SongPackage, difficulty: Difficulty): Promise<{ chart: Chart; derived: boolean }> {
  const explicit = await readChart(pkg, difficulty);
  if (explicit?.notes.length) return { chart: explicit, derived: false };
  const real = await realDifficulties(pkg);
  const hardest = real[real.length - 1];
  if (!hardest) {
    return { chart: { ppq: DEFAULT_PPQ, tempoMap: constantTempoMap(pkg.meta.bpm), timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }], notes: [], duration: pkg.meta.length ?? 0 }, derived: true };
  }
  const src = (await readChart(pkg, hardest))!;
  return { chart: deriveDifficulty(src, difficulty), derived: true };
}

/** Sections detected from the song's hardest chart (none without a chart). */
export async function detectSections(pkg: SongPackage): Promise<SongSection[]> {
  const real = await realDifficulties(pkg);
  const hardest = real[real.length - 1];
  const chart = hardest ? await readChart(pkg, hardest) : null;
  return chart ? proposeSections(buildSongMap(chart)) : [];
}

/** The song's sections: the saved ones, else detected from its hardest chart (`auto`: name them in Studio). */
export async function songSections(pkg: SongPackage): Promise<{ sections: SongSection[]; auto: boolean }> {
  if (pkg.meta.sections?.length) return { sections: pkg.meta.sections, auto: false };
  return { sections: await detectSections(pkg), auto: true };
}

/** Load a song's custom samples into the kit (or restore the default kit). */
export async function applySongKit(app: App, pkg: SongPackage): Promise<void> {
  const samples = pkg.meta.samples ?? {};
  const hasCustom = Object.keys(samples).length > 0;
  if (app.kitCustomized || hasCustom) {
    await app.kit.loadDefault();
    app.kitCustomized = false;
  }
  for (const voice of DRUM_VOICES) {
    const path = samples[voice];
    if (!path) continue;
    const blob = pkg.files.get(path);
    if (!blob) continue;
    try {
      await app.kit.loadSample(voice, await blob.arrayBuffer());
      app.kitCustomized = true;
    } catch (e) {
      console.warn(`sample ${path} failed`, e);
    }
  }
  app.kit.setGain(pkg.meta.sampleGain ?? 1);
}

export async function gameScreen(app: App, params?: Record<string, unknown>): Promise<Screen> {
  const pkg = params?.pkg as SongPackage;
  const difficulty = (params?.difficulty as Difficulty) ?? 'medium';
  const mode = (params?.mode as GameMode) ?? 'play';
  const settings = app.settings;
  /** Practice: start looping these bars (from the results screen's "practice this" button). */
  const loopParam = params?.loop as { first: number; last: number } | undefined;
  localStorage.setItem('dk.lastSong', pkg.meta.id);
  localStorage.setItem('dk.lastDifficulty', difficulty);
  if (params?.back !== 'studio') localStorage.setItem('dk.lastMode', mode);

  const canvas = h('canvas', { class: 'highway' });
  const scoreEl = h('div', { class: 'score' }, '0');
  const multEl = h('div', { class: 'mult' }, '1×');
  const comboEl = h('div', { class: 'combo' }, '0');
  const accEl = h('div', { class: 'acc' }, '100.0%');
  const starsEl = h('div', { class: 'stars-live' }, starString(0));
  const judgeEl = h('div', { class: 'judge' });
  const streakEl = h('div', { class: 'streak' });
  const progressEl = h('div');
  const countdownEl = h('div', { class: 'countdown' });
  const modeTag = h('div', { class: 'mode-tag' });
  const timingEl = h('div', { class: 'timing' }, '');
  const barEl = h('div', { class: 'bar-pos' }, '');
  const keyHint = h('div', { class: 'key-hint' });
  const practiceBar = h('div', { class: 'practice-bar' });
  const loading = h('div', { class: 'pause-overlay' }, h('div', { class: 'display', style: { fontFamily: 'var(--font-display)', fontSize: '28px' } }, 'LOADING…'));

  const hud = h(
    'div',
    { class: 'hud' },
    h('div', { class: 'progress' }, progressEl),
    h('div', { class: 'score-box' }, scoreEl, multEl),
    h('div', { class: 'combo-box' }, comboEl, h('div', { class: 'combo-k' }, 'COMBO')),
    modeTag,
    judgeEl,
    streakEl,
    h('div', { class: 'song-info' }, barEl, h('div', { class: 't' }, pkg.meta.title), h('div', { class: 'a' }, `${pkg.meta.artist} · ${difficulty.toUpperCase()}`)),
    h('div', { class: 'acc-box' }, accEl, starsEl),
    practiceBar,
    timingEl,
    keyHint,
    countdownEl,
  );
  const el = h('div', { class: 'screen game' }, canvas, hud, loading);

  let session: GameSession | null = null;
  let recorder: VideoRecorder | null = null;
  let lastJudge: HudSnapshot['judge'] = null;
  let lastStreak: HudSnapshot['streak'] = null;
  let countdown: number | null = null;
  let pauseOverlay: HTMLElement | null = null;
  let rate = mode === 'practice' ? Number(params?.rate) || Number(localStorage.getItem('dk.practiceRate') ?? 1) || 1 : 1;
  let guideDrums = mode === 'practice' ? localStorage.getItem('dk.guideDrums') === '1' : false;
  /** Bar downbeats (chart seconds) and the last bar with music in it. */
  let starts: number[] = [];
  let lastBar = 0;
  /** Named sections inside bars 1..lastBar; `sectionsAuto` when detected rather than saved with the song. */
  let sections: SongSection[] = [];
  let sectionsAuto = false;
  let shownBar = -1;
  let loopBars: { first: number; last: number } | null = null;

  const JUDGE_COLORS: Record<string, string> = { perfect: '#ffe600', great: '#8dff5a', good: '#3ef2ff', miss: '#ff3b3b' };
  // HUD pops run through the Web Animations API instead of the remove-class / read offsetWidth / add-class
  // trick: that forced a synchronous layout on every judgement, inside the rAF loop and the MIDI handler.
  const JUDGE_POP: Keyframe[] = [
    { opacity: 0, transform: 'translate(-50%, -30%) scale(.6)', offset: 0 },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1.15)', offset: 0.15 },
    { opacity: 0, transform: 'translate(-50%, -80%) scale(1)', offset: 1 },
  ];
  const STREAK_POP: Keyframe[] = [
    { opacity: 0, transform: 'translateX(-50%) scale(.5)', offset: 0 },
    { opacity: 1, transform: 'translateX(-50%) scale(1.1)', offset: 0.12 },
    { opacity: 1, offset: 0.7 },
    { opacity: 0, transform: 'translateX(-50%) translateY(-30px)', offset: 1 },
  ];
  const COMBO_POP: Keyframe[] = [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }];
  const showJudge = (text: string, cls: string) => {
    judgeEl.textContent = text;
    judgeEl.className = `judge ${cls}`;
    judgeEl.animate(JUDGE_POP, { duration: 450, easing: 'ease-out' });
    lastJudge = { text, color: JUDGE_COLORS[cls] ?? '#fff', at: performance.now() };
  };
  let progressFrac = 0;

  /** What the video recorder repaints over the highway (the DOM HUD is not captured). */
  const hudSnapshot = (): HudSnapshot => ({
    score: scoreEl.textContent ?? '0',
    multiplier: multEl.textContent ?? '1×',
    multiplierMax: multEl.classList.contains('max'),
    combo: comboEl.textContent ?? '0',
    accuracy: accEl.textContent ?? '',
    stars: starsEl.textContent ?? '',
    progress: progressFrac,
    title: pkg.meta.title,
    artist: pkg.meta.artist,
    difficulty,
    mode: mode === 'practice' ? 'practice' : 'play',
    judge: lastJudge,
    streak: lastStreak,
    countdown,
  });

  /** Open the webcam and prepare the recorder (never fatal: the game still runs without it). */
  async function setupRecorder(): Promise<void> {
    if (!settings.recordVideo) return;
    if (!videoRecordingSupported()) {
      toast('Video recording is not supported in this browser', 'bad', 4000);
      return;
    }
    let camera: MediaStream | null = null;
    try {
      camera = await openCamera(settings.recordCameraId, settings.recordMic);
    } catch (e) {
      console.warn('camera unavailable', e);
      toast(`Camera unavailable (${(e as Error).name}) — recording the game only`, 'bad', 4000);
    }
    try {
      recorder = new VideoRecorder({
        highway: canvas,
        paintGame: (ctx, frame) => session?.renderer.paintTo?.(ctx, frame) ?? false,
        camera,
        gameAudio: app.engine.captureNode.stream,
        mic: settings.recordMic,
        rotateCamera: settings.recordRotate,
        audioContext: app.engine.ctx,
        captureNode: app.engine.captureNode,
        height: settings.recordResolution,
        accent: pkg.meta.accent,
        hud: hudSnapshot,
      });
      const cam = recorder.cameraElement;
      if (cam) {
        cam.className = `cam-preview${settings.recordRotate ? ' rotated' : ''}`;
        cam.style.setProperty('--cam-aspect', String(CAM_ASPECT));
        hud.appendChild(cam);
      }
      modeTag.appendChild(h('span', { class: 'pill bad' }, h('span', { class: 'rec-dot' }), 'REC'));
    } catch (e) {
      console.error(e);
      camera?.getTracks().forEach((t) => t.stop());
      recorder = null;
      toast(`Could not start video recording: ${(e as Error).message}`, 'bad', 4000);
    }
  }

  async function build(): Promise<void> {
    await app.boot(); // idempotent; covers entry points that skipped it (e.g. a results-screen shortcut)
    const audioBlob = pkg.files.get(pkg.meta.audio);
    if (!audioBlob) throw new Error(`Audio file "${pkg.meta.audio}" missing from song folder`);
    const [audio, { chart, derived }] = await Promise.all([app.engine.decode(await audioBlob.arrayBuffer()), loadChart(pkg, difficulty)]);
    await applySongKit(app, pkg);
    if (!chart.notes.length) toast('This chart has no notes.', 'bad');
    if (derived && mode === 'play') modeTag.appendChild(h('span', { class: 'pill' }, 'AUTO CHART'));
    if (mode === 'practice') modeTag.appendChild(h('span', { class: 'pill warn' }, 'PRACTICE · NO SCORE'));
    starts = barStarts(computeBeats(chart, audio.duration - pkg.meta.offset));
    lastBar = Math.max(1, barAt(Math.max(0, chart.duration - 0.001), starts));
    ({ sections, auto: sectionsAuto } = await songSections(pkg).catch(() => ({ sections: [] as SongSection[], auto: false })));
    sections = sections.filter((s) => s.bar <= lastBar);
    if (mode === 'practice' && loopParam && starts.length) loopBars = { first: loopParam.first, last: Math.min(loopParam.last, starts.length) };

    session = new GameSession(
      app.engine,
      app.kit,
      canvas,
      {
        mode,
        meta: pkg.meta,
        chart,
        difficulty,
        audio,
        rate,
        guideDrums,
        inputOffset: settings.inputOffset,
        hitWindowScale: settings.hitWindowScale,
        strictVoices: settings.strictVoices,
        scrollWindow: settings.scrollWindow,
        drumSoundsOnHit: settings.drumSoundsOnHit,
        reducedMotion: settings.reducedMotion,
        laneOrder: settings.laneOrder,
        view: settings.playView,
        sections,
        renderScale: settings.renderScale,
        loop: loopBars ? barSpan(loopBars.first, loopBars.last, starts) : null,
      },
      {
        onJudge: (ev) => {
          scoreEl.textContent = fmtScore(ev.score);
          comboEl.textContent = String(ev.combo);
          comboEl.animate(COMBO_POP, { duration: 160, easing: 'ease-out' });
          multEl.textContent = `${ev.multiplier}×`;
          multEl.classList.toggle('max', ev.multiplier >= 4);
          if (ev.kind === 'hit') showJudge(ev.judgement.toUpperCase() + (Math.abs(ev.delta) > 0.02 ? (ev.delta < 0 ? ' ‹' : ' ›') : ''), ev.judgement);
          else if (ev.kind === 'miss') showJudge('MISS', 'miss');
          else if (Number.isNaN(ev.delta)) showJudge('OVERHIT', 'miss');
          else showJudge(`${ev.delta < 0 ? 'EARLY' : 'LATE'} ${Math.round(Math.abs(ev.delta) * 1000)}ms`, 'miss');
          const j = session!.judge;
          updateTiming();
          accEl.textContent = `${(j.accuracy * 100).toFixed(1)}%`;
          const ratio = j.maxScore ? j.score / Math.max(1, (j.judgedCount / Math.max(1, j.totalNotes)) * j.maxScore) : 0;
          starsEl.textContent = starString(Math.min(5, Math.round(Math.max(0, Math.min(1, ratio)) * 10) / 2));
        },
        onStreak: (combo) => {
          streakEl.textContent = combo >= 100 ? `${combo} KILLSTREAK` : `${combo} COMBO`;
          lastStreak = { text: streakEl.textContent, at: performance.now() };
          streakEl.animate(STREAK_POP, { duration: 1400, easing: 'ease-out' });
        },
        onTick: (pos, dur) => {
          // A transform instead of a width so the bar never triggers layout, and only when it visibly moved
          // (a fresh float every frame forced the full style/layout/paint pipeline on the HUD each rAF).
          const f = Math.max(0, Math.min(1, pos / dur));
          if (Math.abs(f - progressFrac) >= 0.0005) {
            progressFrac = f;
            progressEl.style.transform = `scaleX(${f.toFixed(4)})`;
          }
          // Only touch the DOM when the bar actually changes.
          const bar = session ? barAt(session.chartTime, starts) : 0;
          if (bar !== shownBar) {
            shownBar = bar;
            const section = sections[sectionIndexAt(bar)];
            barEl.textContent = bar < 1 ? 'COUNT-IN' : bar > lastBar ? 'OUTRO' : `BAR ${bar} / ${lastBar}${section ? ` · ${section.name}` : ''}`;
            refreshSection();
          }
        },
        onCountdown: (n) => {
          countdown = n;
          countdownEl.textContent = n === null ? '' : String(n);
        },
        onFrame: () => recorder?.frame(),
        onFinish: (summary) => finish(summary),
      },
      app.input,
    );
    (window as unknown as { dkSession: GameSession | null }).dkSession = session;
    updateTiming();
    await setupRecorder();
    loading.remove();
    if (mode === 'practice') buildPracticeBar();
    renderKeyHint();
    const countIn = 3;
    if (recorder) {
      // Prime the highway so the recording's first frame (the preview's poster) shows the road.
      session.drawFrame(countIn);
      await recorder.start();
    }
    await session.start(countIn);
  }

  let inputOffset = settings.inputOffset;
  function updateTiming(): void {
    if (!session) return;
    const st = session.judge.timingStats();
    const avg = st.count ? `${st.mean > 0 ? '+' : ''}${Math.round(st.mean * 1000)}ms ${st.mean > 0.015 ? 'LATE' : st.mean < -0.015 ? 'EARLY' : 'ON TIME'}` : '—';
    timingEl.textContent = `timing avg ${avg} (${st.count}) · input offset ${Math.round(inputOffset * 1000)} ms`;
  }
  function nudgeOffset(deltaMs: number): void {
    inputOffset = Math.round((inputOffset * 1000 + deltaMs)) / 1000;
    app.settingsStore.update({ inputOffset });
    session?.setInputOffset(inputOffset);
    updateTiming();
    toast(`Input offset ${Math.round(inputOffset * 1000)} ms`);
  }
  function autoFixOffset(): void {
    if (!session) return;
    const st = session.judge.timingStats();
    if (st.count < 4) {
      toast('Play a few more notes first', 'bad');
      return;
    }
    inputOffset = Math.round((inputOffset - st.mean) * 1000) / 1000;
    app.settingsStore.update({ inputOffset });
    session.setInputOffset(inputOffset);
    session.judge.reseek(session.chartTime);
    updateTiming();
    toast(`Input offset set to ${Math.round(inputOffset * 1000)} ms`, 'ok');
  }

  /** Keys that play drums win over every shortcut below. */
  const isDrumKey = (code: string) => Object.values(app.settings.keyboard).some((codes) => codes.includes(code));
  const LOOP_LENGTHS = [1, 2, 4, 8];

  function renderKeyHint(): void {
    const k = (key: string) => h('kbd', null, key);
    keyHint.replaceChildren(
      ...(mode === 'practice' ? [k('↑'), k('↓'), ' speed  ', k('←'), k('→'), ' bar  ', ...(sections.length ? [k('⇧←'), k('⇧→'), ' section  '] : []), k('1'), k('2'), k('4'), k('8'), ' loop bars  ', k('0'), ' no loop  '] : []),
      k('['), k(']'), ' offset  ', k('Esc'), ' pause',
    );
  }

  let refreshPractice = () => {};
  let refreshSection = () => {};
  /** Index of the section holding `bar`, or -1 before the first one. */
  function sectionIndexAt(bar: number): number {
    let i = -1;
    while (i + 1 < sections.length && sections[i + 1].bar <= bar) i++;
    return i;
  }
  /** Bars of section `i`: from its bar to the bar before the next section (or the last bar). */
  function sectionSpan(i: number): { first: number; last: number } {
    const first = sections[i].bar;
    return { first, last: Math.max(first, Math.min(lastBar, (sections[i + 1]?.bar ?? lastBar + 1) - 1)) };
  }
  /** The loop covers exactly section `i`. */
  const loopIsSection = (i: number) => i >= 0 && !!loopBars && loopBars.first === sectionSpan(i).first && loopBars.last === sectionSpan(i).last;
  function setRate(r: number): void {
    rate = Math.max(0.5, Math.min(1.25, Math.round(r * 20) / 20));
    localStorage.setItem('dk.practiceRate', String(rate));
    session?.setRate(rate);
    refreshPractice();
  }
  /** Jump by bars. Back from the middle of a bar restarts that bar first, like a media player's ⏮. */
  function stepBar(delta: number): void {
    if (!session || !starts.length) return;
    // Measure from where the run-up is heading, so repeated presses keep moving instead of
    // landing back in the bar the previous jump's run-up started in.
    const cur = Math.max(1, barAt(session.chartTime, starts));
    const runUp = (barSpan(cur, cur, starts).end - starts[cur - 1]) / 4; // one beat
    const t = session.chartTime + runUp + 0.01;
    const b = Math.max(1, barAt(t, starts));
    let target = b + delta;
    if (delta < 0 && t - starts[b - 1] > runUp + 0.75) target = b;
    seekToBar(Math.max(1, Math.min(lastBar, target)));
  }
  /** Jump to the start of a bar with a one-beat run-up. */
  function seekToBar(bar: number): void {
    if (!session) return;
    const { start, end } = barSpan(bar, bar, starts);
    session.seek(start - (end - start) / 4);
    jumpTarget = bar;
  }
  /**
   * Jump by sections. Back from inside a section restarts it first, like ⏮. While a section is looping, the
   * loop moves with the jump.
   */
  function stepSection(delta: number): void {
    if (!session || !sections.length) return;
    const cur = currentBar();
    const i = sectionIndexAt(cur);
    let target = i + delta;
    if (delta < 0 && i >= 0 && cur > sections[i].bar) target = i;
    target = Math.max(0, Math.min(sections.length - 1, target));
    if (loopIsSection(i)) {
      loopBars = sectionSpan(target);
      session.setLoop(barSpan(loopBars.first, loopBars.last, starts));
    }
    seekToBar(sections[target].bar);
    refreshPractice();
  }
  /** Loop the section you are in. */
  function loopSection(): void {
    if (!session || !sections.length) return;
    const i = Math.max(0, sectionIndexAt(currentBar()));
    loopBars = sectionSpan(i);
    session.setLoop(barSpan(loopBars.first, loopBars.last, starts));
    refreshPractice();
  }
  /** Bar the last ◀/▶ jumped to: during its run-up, "current bar" means that one. */
  let jumpTarget = 0;
  function currentBar(): number {
    const t = session!.chartTime;
    if (jumpTarget && t < starts[jumpTarget - 1] && t > starts[jumpTarget - 1] - 2) return jumpTarget;
    return Math.max(1, Math.min(lastBar, barAt(t, starts)));
  }
  function setLoop(n: number | null): void {
    if (!session || !starts.length) return;
    if (n === null) loopBars = null;
    else {
      const first = currentBar();
      loopBars = { first, last: Math.min(lastBar, first + n - 1) };
    }
    session.setLoop(loopBars ? barSpan(loopBars.first, loopBars.last, starts) : null);
    refreshPractice();
  }
  function setGuide(on: boolean): void {
    guideDrums = on;
    localStorage.setItem('dk.guideDrums', on ? '1' : '0');
    session?.setGuideDrums(on);
    refreshPractice();
  }

  /** Grid ↔ highway, mid-take; remembered for the next song. */
  function toggleView(): void {
    if (!session) return;
    const view = session.view === 'grid' ? 'highway' : 'grid';
    session.setView(view);
    app.settingsStore.update({ playView: view });
    refreshPractice();
  }

  function buildPracticeBar(): void {
    const rateEl = h('span', { class: 'rate' });
    const loopBtns = LOOP_LENGTHS.map((n) => button(String(n), () => setLoop(n), 'icon small'));
    const loopLabel = h('span', { class: 'loop-label' });
    const clearLoop = button('✕', () => setLoop(null), 'icon small ghost');
    const guideBtn = button('', () => setGuide(!guideDrums), 'icon small');
    const viewBtn = button('', toggleView, 'icon small');
    const sectionLabel = h('span', { class: 'section-label' });
    const loopSectionBtn = button('LOOP', loopSection, 'icon small');
    const group = (label: string, ...items: HTMLElement[]) => h('div', { class: 'pgroup' }, h('span', { class: 'plabel' }, label), ...items);
    refreshPractice = () => {
      rateEl.textContent = `${Math.round(rate * 100)}%`;
      rateEl.title = `${Math.round(pkg.meta.bpm * rate)} BPM`;
      const looped = sections.findIndex((_, i) => loopIsSection(i));
      loopLabel.textContent = loopBars ? `${looped >= 0 ? `${sections[looped].name} · ` : ''}${loopBars.first === loopBars.last ? `BAR ${loopBars.first}` : `BARS ${loopBars.first}–${loopBars.last}`}` : 'OFF';
      loopSectionBtn.classList.toggle('active', looped >= 0);
      refreshSection();
      loopLabel.classList.toggle('on', !!loopBars);
      clearLoop.hidden = !loopBars;
      loopBtns.forEach((b, i) => b.classList.toggle('active', !!loopBars && loopBars.last - loopBars.first + 1 === LOOP_LENGTHS[i]));
      guideBtn.textContent = `GUIDE DRUMS ${guideDrums ? 'ON' : 'OFF'}`;
      viewBtn.textContent = session?.view === 'highway' ? 'VIEW: HIGHWAY' : 'VIEW: GRID';
      guideBtn.classList.toggle('active', guideDrums);
    };
    refreshSection = () => {
      const i = session ? sectionIndexAt(currentBar()) : -1;
      sectionLabel.textContent = i >= 0 ? sections[i].name : '—';
    };
    practiceBar.replaceChildren(
      group('SPEED', button('−', () => setRate(rate - 0.05), 'icon small'), rateEl, button('+', () => setRate(rate + 0.05), 'icon small')),
      group('BAR', button('◀', () => stepBar(-1), 'icon small'), button('▶', () => stepBar(1), 'icon small')),
      ...(sections.length
        ? [h('div', { class: 'pgroup', title: sectionsAuto ? 'Sections detected from the chart. Name them in Studio → SONG.' : '' },
            h('span', { class: 'plabel' }, sectionsAuto ? 'SECTION (AUTO)' : 'SECTION'),
            button('◀', () => stepSection(-1), 'icon small'), sectionLabel, button('▶', () => stepSection(1), 'icon small'), loopSectionBtn)]
        : []),
      group('LOOP', ...loopBtns, loopLabel, clearLoop),
      guideBtn,
      viewBtn,
    );
    refreshPractice();
  }

  // Pads drive the pause menu only; while playing they are the instrument.
  const pauseFocus = focusList(
    () => (pauseOverlay ? Array.from(pauseOverlay.querySelectorAll<HTMLElement>('.menu > .btn')) : []),
    () => pauseOverlay?.querySelector<HTMLElement>('.menu > .btn.primary'),
  );
  const pads = attachPadNav(app, () => (pauseOverlay ? { ...pauseFocus, back: togglePause, backLabel: 'RESUME' } : null));

  function togglePause(): void {
    if (!session) return;
    if (pauseOverlay) {
      pauseOverlay.remove();
      pauseOverlay = null;
      session.resume();
      pads.refresh();
      return;
    }
    session.pause();
    const st = session.judge.timingStats();
    const late = st.mean > 0;
    const timingPanel = h(
      'div',
      { class: 'panel tight pause-timing' },
      h('div', { class: 'small dim' }, 'TIMING'),
      h('div', { class: 'mono' }, st.count ? `Averaging ${Math.round(Math.abs(st.mean) * 1000)} ms ${late ? 'LATE' : 'EARLY'} over ${st.count} hits` : 'No hits yet'),
      h('div', { class: 'small mute' }, `Input offset ${Math.round(inputOffset * 1000)} ms · hit window ×${settings.hitWindowScale.toFixed(2)}`),
      h('div', { class: 'btn-row nowrap' },
        button('−10 ms', () => { nudgeOffset(-10); togglePause(); togglePause(); }, 'icon small'),
        button('AUTO-FIX OFFSET', () => { autoFixOffset(); togglePause(); }, `small ${Math.abs(st.mean) > 0.02 && st.count >= 4 ? 'primary' : ''}`),
        button('+10 ms', () => { nudgeOffset(10); togglePause(); togglePause(); }, 'icon small'),
      ),
    );
    const k = (key: string) => h('kbd', null, key);
    const canReview = session.judge.judgedCount > 0;
    pauseOverlay = h(
      'div',
      { class: 'pause-overlay' },
      h(
        'div',
        { class: 'menu' },
        h('h2', { class: 'display' }, 'PAUSED'),
        h('div', { class: 'small dim', style: { textAlign: 'center' } }, `${pkg.meta.title} · ${difficulty.toUpperCase()}${mode === 'practice' ? ` · ${Math.round(rate * 100)}%` : ''}${shownBar >= 1 && shownBar <= lastBar ? ` · bar ${shownBar} of ${lastBar}` : ''}`),
        button([h('span', null, 'RESUME'), h('span', { class: 'hint' }, k('Esc'), ' ', k('↵'))], togglePause, 'primary'),
        button([h('span', null, 'RESTART'), h('span', { class: 'hint' }, k('R'))], () => restart()),
        mode === 'practice' && canReview ? button([h('span', null, 'END & REVIEW'), h('span', { class: 'hint' }, 'see where it slipped')], () => session?.finishNow()) : null,
        button([h('span', null, 'QUIT'), h('span', { class: 'hint' }, k('Q'))], () => quit()),
        timingPanel,
      ),
    );
    el.appendChild(pauseOverlay);
    pads.refresh();
  }

  function restart(): void {
    session?.stop();
    recorder?.discard();
    recorder = null;
    app.navigate('game', { ...params, rate, loop: loopBars ?? undefined });
  }

  function quit(): void {
    session?.stop();
    recorder?.discard();
    recorder = null;
    if (params?.back === 'studio') app.navigate('studio');
    else app.navigate(mode === 'practice' ? 'songs-practice' : 'songs');
  }

  function finish(summary: ScoreSummary): void {
    // Every judged hit with its signed timing error, for the results screen's heatmap (and the video's card).
    const hits: TimingHit[] = [];
    for (const n of session?.judge.notes ?? []) if (n.state === 'hit' && n.delta !== undefined && n.judgement) hits.push({ voice: n.voice, delta: n.delta, judgement: n.judgement });
    const windows = session?.judge.windows ?? hitWindowsFor(difficulty, settings.hitWindowScale);
    // The recording keeps going for a few seconds showing the results card; the results screen shows
    // the video as soon as it is ready rather than making the player wait for it.
    let video: Promise<RecordedVideo | undefined> | undefined;
    if (recorder) {
      const rec = recorder;
      recorder = null;
      video = rec
        .finish({ title: pkg.meta.title, artist: pkg.meta.artist, difficulty, mode: mode === 'practice' ? 'practice' : 'play', verdict: verdictFor(summary), summary, hits, windows, laneOrder: settings.laneOrder })
        .catch((e: unknown) => {
          console.error(e);
          toast('Video recording failed', 'bad');
          return undefined;
        });
    }
    const notes: BarNote[] = (session?.judge.notes ?? []).map((n) => ({ time: n.time, judgement: n.judgement }));
    app.navigate('results', { pkg, difficulty, mode, summary, rate, timing: session?.judge.timingStats(), hits, windows, video, back: params?.back, bars: { notes, starts, lastBar } });
  }

  const onKey = (e: KeyboardEvent) => {
    if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      togglePause();
    } else if (isDrumKey(e.code)) {
      return;
    } else if (pauseOverlay) {
      if (e.code === 'Enter' && !(e.target as HTMLElement | null)?.closest?.('button')) togglePause();
      else if (e.code === 'KeyR') restart();
      else if (e.code === 'KeyQ') quit();
      else return;
      e.preventDefault();
    } else if (e.code === 'BracketLeft') {
      e.preventDefault();
      nudgeOffset(-10);
    } else if (e.code === 'BracketRight') {
      e.preventDefault();
      nudgeOffset(10);
    } else if (mode === 'practice' && session) {
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (e.code === 'ArrowUp') setRate(rate + 0.05);
      else if (e.code === 'ArrowDown') setRate(rate - 0.05);
      else if (e.code === 'ArrowLeft') (e.shiftKey ? stepSection(-1) : stepBar(-1));
      else if (e.code === 'ArrowRight') (e.shiftKey ? stepSection(1) : stepBar(1));
      else if (digit && !e.repeat && LOOP_LENGTHS.includes(Number(digit[1]))) setLoop(Number(digit[1]));
      else if (digit && !e.repeat && digit[1] === '0') setLoop(null);
      else return;
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);
  // Pause when the tab loses focus (fairness).
  const onVis = () => {
    if (document.hidden && session && !session.isPaused && !pauseOverlay) togglePause();
  };
  document.addEventListener('visibilitychange', onVis);

  build().catch((err) => {
    console.error(err);
    toast(`Failed to start: ${(err as Error).message}`, 'bad');
    quit();
  });

  return {
    el,
    dispose: () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
      pads.dispose();
      session?.stop();
      recorder?.discard();
      recorder = null;
    },
  };
}
