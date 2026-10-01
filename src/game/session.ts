import type { Chart, Difficulty, DrumVoice, InputHit, Lane, PlayView, ScoreSummary, SongMeta, SongSection } from '@/types';
import { Transport, ChartPlayer } from '@/audio';
import type { AudioEngine, DrumKit } from '@/audio';
import { ticksToSeconds } from '@/midi';
import { Judge, type JudgeEvent } from './scoring';
import { HighwayRenderer, type BeatMark, type PlayRenderer, type RenderState } from './renderer';
import { GridRenderer } from './gridRenderer';
import { barAt, barStarts } from './bars';
import { QuietCount, type QuietCycle, type QuietReport } from './quiet';

export type GameMode = 'play' | 'practice';

export interface SessionConfig {
  mode: GameMode;
  meta: SongMeta;
  chart: Chart;
  difficulty: Difficulty;
  audio: AudioBuffer;
  rate?: number;
  /** Practice: play the chart's drums as a guide. */
  guideDrums?: boolean;
  inputOffset: number;
  hitWindowScale: number;
  strictVoices: boolean;
  scrollWindow: number;
  drumSoundsOnHit: boolean;
  reducedMotion: boolean;
  laneOrder: Lane[];
  /** Drum-tab lines or the highway (switchable mid-take with {@link GameSession.setView}). */
  view: PlayView;
  /** Named sections, drawn on the grid's bar headers. */
  sections?: SongSection[];
  /** Cap on canvas device pixels per CSS pixel (see Settings.renderScale). */
  renderScale: number;
  /** Loop region for practice (chart seconds). */
  loop?: { start: number; end: number } | null;
  /** Practice: Quiet Count cycle (bars with the song, bars without), or null. */
  quiet?: QuietCycle | null;
}

export interface SessionCallbacks {
  onJudge?: (ev: JudgeEvent) => void;
  onStreak?: (combo: number) => void;
  onFinish?: (summary: ScoreSummary) => void;
  onTick?: (position: number, duration: number) => void;
  onCountdown?: (n: number | null) => void;
  /** After each highway frame is drawn (used by the video recorder to composite). */
  onFrame?: () => void;
  /** Practice: a pass round the loop just finished; the judge still holds its notes (the wrap resets them next). */
  onPass?: () => void;
  /** Quiet Count: a quiet stretch began (true) or ended (false). */
  onQuiet?: (quiet: boolean) => void;
  /** Quiet Count: how the quiet stretch that just ended went (a moment after it, so late hits count). */
  onQuietReport?: (report: QuietReport) => void;
}

/**
 * A single play/practice session: ties Transport, Judge, Renderer, DrumKit, and input together.
 */
export class GameSession {
  readonly transport: Transport;
  readonly judge: Judge;
  /** Replaced by {@link setView}; read it fresh rather than keeping a reference. */
  renderer: PlayRenderer;
  readonly beats: BeatMark[];
  private guide: ChartPlayer | null = null;
  private raf = 0;
  private running = false;
  private finished = false;
  private unsubInput: (() => void) | null = null;
  private countdownTimer = 0;
  private lastStreak = 0;
  private paused = false;
  private resizeHandler = () => this.renderer.resize();
  private latencyComp = 0;
  private analyser: AnalyserNode | null = null;
  /** Velocity of the pad stroke that last hit each note (MIDI only; the keyboard has no dynamics). */
  private played = new Map<number, number>();
  private readonly starts: number[];
  private quiet: QuietCount | null = null;
  /** Song bar the quiet count last saw (0 = none yet). */
  private quietBar = 0;
  /** The next bar change is a loop wrap (the cycle runs on), not a jump (it restarts). */
  private wrapping = false;
  /** Chart time the current quiet stretch began, or null when the song is playing. */
  private quietSince: number | null = null;
  private quietReportDue: { firstLoud: number; at: number } | null = null;
  /** Bar line (chart s) whose song-level change is already scheduled on the audio clock. */
  private quietScheduled = -1;

  constructor(
    private engine: AudioEngine,
    private kit: DrumKit,
    private canvas: HTMLCanvasElement,
    readonly cfg: SessionConfig,
    private cb: SessionCallbacks,
    private inputSource: { onHit(fn: (hit: InputHit) => void): () => void },
  ) {
    this.transport = new Transport(engine);
    this.transport.load(cfg.audio);
    this.transport.setRate(cfg.rate ?? 1);
    this.judge = new Judge(cfg.chart.notes, {
      difficulty: cfg.difficulty,
      strictVoices: cfg.strictVoices && (cfg.difficulty === 'hard' || cfg.difficulty === 'expert'),
      overhitBreaksCombo: true,
      windowScale: cfg.hitWindowScale,
    });
    this.renderer = this.makeRenderer(cfg.view);
    // Background visualiser: tap the master bus (song + drums) with an analyser. Never fatal if unavailable.
    try {
      const an = engine.ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.6;
      engine.master.connect(an);
      this.analyser = an;
      this.renderer.setAnalyser(an);
    } catch {
      this.analyser = null;
    }
    this.beats = computeBeats(cfg.chart, this.audioDuration - cfg.meta.offset);
    this.starts = barStarts(this.beats);
    if (cfg.quiet) this.quiet = new QuietCount(cfg.quiet);
    this.judge.onEvent((ev) => this.handleJudge(ev));
    if (cfg.mode === 'practice') {
      // Always built in practice so guide drums can be switched on and off mid-take.
      this.guide = new ChartPlayer(engine, kit, this.transport);
      this.guide.setNotes(cfg.chart.notes);
      this.guide.setOffset(cfg.meta.offset);
      this.guide.setEnabled(!!cfg.guideDrums);
      this.guide.skip = (time) => this.quietAtTime(time);
    }
    // Compensate for audio output latency: what the player hears is later than the audio clock.
    this.latencyComp = engine.inputLatencyCompensation;
    window.addEventListener('resize', this.resizeHandler);
  }

  private makeRenderer(view: PlayView): PlayRenderer {
    const r = view === 'highway' ? new HighwayRenderer(this.canvas) : new GridRenderer(this.canvas);
    r.setReducedMotion(this.cfg.reducedMotion);
    r.setLaneOrder(this.cfg.laneOrder);
    r.setRenderScale(this.cfg.renderScale);
    return r;
  }

  get view(): PlayView {
    return this.cfg.view;
  }

  /** Switch between the grid and the highway, mid-take if need be. */
  setView(view: PlayView): void {
    if (view === this.cfg.view) return;
    (this.cfg as { view: PlayView }).view = view;
    this.renderer = this.makeRenderer(view);
    this.renderer.setAnalyser(this.analyser);
  }

  /** Velocity (0..1) of the pad stroke that hit note `index`, if it came from a MIDI pad. */
  playedVelocity(index: number): number | undefined {
    return this.played.get(index);
  }

  get audioDuration(): number {
    return this.cfg.audio.duration;
  }

  /** Chart time now. */
  get chartTime(): number {
    return this.transport.position - this.cfg.meta.offset;
  }

  /** Chart time as the judge sees it for a hit arriving now (input offset + latency compensation applied). */
  private judgeTime(chartTime: number): number {
    return chartTime + this.cfg.inputOffset - this.latencyComp * this.transport.rate;
  }

  get duration(): number {
    return Math.max(this.cfg.chart.duration, this.audioDuration - this.cfg.meta.offset);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Start with a count-in (seconds of pre-roll before audio time 0). */
  async start(countInSeconds = 3): Promise<void> {
    this.running = true;
    this.paused = false;
    this.unsubInput = this.inputSource.onHit((hit) => this.handleHit(hit));
    const from = this.cfg.loop ? this.cfg.loop.start + this.cfg.meta.offset - 1.5 : -countInSeconds;
    // Starting inside the song: the bars before the loop were never played, so they are not misses.
    if (this.cfg.loop) this.judge.reseek(this.cfg.loop.start);
    this.transport.play(from);
    this.guide?.start();
    this.transport.onEnded = () => this.onAudioEnded();
    this.runCountdown(countInSeconds);
    this.loop();
  }

  private runCountdown(seconds: number): void {
    if (seconds <= 0) return;
    let n = Math.ceil(seconds);
    this.cb.onCountdown?.(n);
    clearInterval(this.countdownTimer);
    this.countdownTimer = window.setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(this.countdownTimer);
        this.cb.onCountdown?.(null);
      } else this.cb.onCountdown?.(n);
    }, 1000 / this.transport.rate);
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.transport.pause();
    this.guide?.stop();
    clearInterval(this.countdownTimer);
    this.cb.onCountdown?.(null);
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Rewind a touch so the player can get back into the groove
    const pos = Math.max(-1.5, this.transport.position - 1.5);
    this.judge.reseek(pos - this.cfg.meta.offset);
    this.restartQuiet();
    this.transport.play(pos);
    this.guide?.start();
    this.runCountdown(1.5);
  }

  setRate(rate: number): void {
    this.transport.setRate(rate);
    this.guide?.resync();
  }

  /** Practice: play the chart's drums along with the song (takes effect immediately). */
  setGuideDrums(on: boolean): void {
    (this.cfg as { guideDrums?: boolean }).guideDrums = on;
    this.guide?.setEnabled(on);
    this.guide?.resync();
  }

  /** Practice: loop a region (chart seconds), or null to play through. */
  setLoop(loop: { start: number; end: number } | null): void {
    (this.cfg as { loop?: { start: number; end: number } | null }).loop = loop;
  }

  /** Live-adjust the input offset (seconds) — affects hits from now on. */
  setInputOffset(seconds: number): void {
    (this.cfg as { inputOffset: number }).inputOffset = seconds;
  }

  /** Practice: Quiet Count on with a cycle, or off (null). Starts counting from the next bar, loud. */
  setQuiet(cycle: QuietCycle | null): void {
    (this.cfg as { quiet?: QuietCycle | null }).quiet = cycle;
    this.restartQuiet();
    this.quiet = cycle ? new QuietCount(cycle) : null;
    this.guide?.resync();
  }

  get quietCycle(): QuietCycle | null {
    return this.cfg.quiet ?? null;
  }

  /** Inside a quiet stretch right now. */
  get isQuiet(): boolean {
    return this.quietSince !== null;
  }

  /** Practice: jump to a chart time. `wrap` = the loop coming round (Quiet Count runs on); else it restarts. */
  seek(chartTime: number, wrap = false): void {
    const pos = chartTime + this.cfg.meta.offset;
    if (wrap) this.wrapping = true;
    else this.restartQuiet();
    this.judge.reseek(chartTime);
    this.transport.seek(pos);
    this.guide?.resync();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.countdownTimer);
    this.transport.stop();
    this.guide?.stop();
    this.unsubInput?.();
    window.removeEventListener('resize', this.resizeHandler);
    if (this.analyser) {
      try {
        this.engine.master.disconnect(this.analyser);
      } catch {
        /* already gone */
      }
      this.renderer.setAnalyser(null);
      this.analyser = null;
    }
  }

  private handleHit(hit: InputHit): void {
    if (!this.running || this.paused) return;
    if (this.cfg.drumSoundsOnHit) this.kit.trigger(hit.voice, hit.velocity);
    const pos = this.transport.positionAtPerfTime(hit.timeStamp);
    const t = this.judgeTime(pos - this.cfg.meta.offset);
    this.renderer.drumPulse(hit.voice, hit.velocity);
    if (t < -0.5 || !this.judge.judges(hit.voice)) return;
    const ev = this.judge.hit(hit.voice, t);
    this.renderer.stroke(ev.voice, t, ev.kind === 'hit' ? ev.judgement : 'over');
    if (ev.kind === 'hit' && hit.raw) this.played.set(ev.noteIndex, hit.velocity);
  }

  private handleJudge(ev: JudgeEvent): void {
    if (this.quiet && ev.kind !== 'overhit') this.quiet.record(this.quietIndexOf(this.judge.notes[ev.noteIndex].time), ev.kind === 'hit' ? ev.delta : null);
    // In a quiet stretch nothing on screen may say how the timing is going: that is the test.
    const quiet = this.isQuiet;
    if (quiet) {
      /* no flashes, ghosts or bursts */
    } else if (ev.kind === 'hit') {
      this.renderer.hitFlash(ev.voice, ev.judgement);
      const note = this.judge.notes[ev.noteIndex];
      this.renderer.hitGhost(ev.voice, ev.delta, note?.velocity ?? 1, ev.judgement);
    } else if (ev.kind === 'overhit') this.renderer.hitFlash(ev.voice, 'over');
    else this.renderer.hitFlash(ev.voice, 'miss');
    this.cb.onJudge?.(ev);
    const milestones = [25, 50, 100, 150, 200, 300, 400, 500, 750, 1000];
    if (!quiet && ev.kind === 'hit' && milestones.includes(ev.combo) && ev.combo !== this.lastStreak) {
      this.lastStreak = ev.combo;
      this.renderer.streakBurst();
      this.cb.onStreak?.(ev.combo);
    }
  }

  /**
   * Draw one highway frame at a chart time without running the session — used to prime the canvas
   * before the video recorder starts, so the recording's first frame (and the preview's poster)
   * shows the road rather than an empty canvas. Defaults to where a count-in of `countInSeconds`
   * would begin.
   */
  drawFrame(countInSeconds = 3): void {
    const from = this.cfg.loop ? this.cfg.loop.start - 1.5 : -countInSeconds - this.cfg.meta.offset;
    this.render(from);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = this.chartTime;
    if (!this.paused) {
      this.judge.update(this.judgeTime(t));
      if (this.cfg.loop && t >= this.cfg.loop.end) {
        this.cb.onPass?.();
        this.seek(this.cfg.loop.start, true);
      }
      this.trackQuiet(this.chartTime);
    }
    this.render(t);
    this.cb.onTick?.(this.transport.position, this.audioDuration);
    if (!this.finished && !this.paused && this.judge.finished && t > this.cfg.chart.duration && this.cfg.mode === 'play') {
      // Chart done: end a little early rather than waiting for a long outro.
      if (t > this.duration - 0.5 || t > this.cfg.chart.duration + 4) this.finish();
    }
  };

  private render(t: number): void {
    const state: RenderState = {
      time: t,
      window: this.cfg.scrollWindow * (this.cfg.mode === 'practice' ? 1 : 1),
      notes: this.judge.notes,
      beats: this.beats,
      combo: this.judge.combo,
      multiplier: this.judge.multiplier,
      mode: this.cfg.mode,
      paused: this.paused,
      accent: this.cfg.meta.accent,
      sections: this.cfg.sections,
      quiet: this.quietSince !== null ? { since: this.quietSince } : null,
    };
    this.renderer.draw(state);
    this.cb.onFrame?.();
  }

  // ── Quiet Count ──

  /** The bar the song moves to after `bar`: the next one, or the loop's first at the loop's end. */
  private barAfter(bar: number): number {
    const loop = this.cfg.loop;
    if (loop && (this.starts[bar] ?? Infinity) >= loop.end - 1e-6) return barAt(loop.start + 1e-6, this.starts);
    return bar + 1;
  }

  /** Played-bar index for a note at chart time `time`: this bar, the next one (an early hit) or the last one (late). */
  private quietIndexOf(time: number): number {
    const q = this.quiet!;
    const bar = barAt(time, this.starts);
    if (bar === this.quietBar) return q.bar;
    return bar === this.barAfter(this.quietBar) ? q.bar + 1 : q.bar - 1;
  }

  /** Whether a note at chart time `time` falls in a quiet bar (the guide drums skip those). */
  private quietAtTime(time: number): boolean {
    const q = this.quiet;
    if (!q || this.quietBar < 1) return false;
    const bar = barAt(time, this.starts);
    if (bar === this.quietBar) return q.quiet;
    return bar === this.barAfter(this.quietBar) && q.quietAt(1);
  }

  /** A jump: the cycle starts again with the song playing. */
  private restartQuiet(): void {
    this.wrapping = false;
    this.quietBar = 0;
    this.quietReportDue = null;
    this.quietScheduled = -1;
    this.quiet?.restart();
    if (this.quiet || this.quietSince !== null) this.transport.setGain(1);
    if (this.quietSince !== null) {
      this.quietSince = null;
      this.cb.onQuiet?.(false);
    }
  }

  /** Per frame: follow the bars played, mute and unmute the song on its bar lines, and report each quiet stretch. */
  private trackQuiet(t: number): void {
    const q = this.quiet;
    if (!q) return;
    const bar = barAt(t, this.starts);
    if (bar < 1) return; // count-in
    if (bar !== this.quietBar) {
      // A bar joined after its first beat was not played from its downbeat: the run-up before a loop (1.5 s)
      // or a jump (one beat), or the moment after a wrap while the heard audio still lags the seek. Note it,
      // but do not count it.
      const barLen = (this.starts[bar] ?? this.starts[bar - 1] + 2) - this.starts[bar - 1];
      const fromDownbeat = t - this.starts[bar - 1] < barLen / 4;
      const progressed = this.quietBar > 0 && (bar === this.quietBar + 1 || this.wrapping);
      this.quietBar = bar;
      if (!fromDownbeat) return;
      if (!progressed) q.restart();
      this.wrapping = false;
      const change = q.next();
      // The level for this bar now, in case its scheduled change was missed (a wrap, a jump, a slow frame).
      this.transport.setGain(q.quiet ? 0 : 1);
      if (change === 'quiet') {
        this.quietSince = this.starts[bar - 1];
        this.cb.onQuiet?.(true);
      } else if (change === 'loud') {
        this.quietSince = null;
        this.cb.onQuiet?.(false);
        this.quietReportDue = { firstLoud: q.bar, at: t + 0.3 };
      }
    }
    // The next bar line's change goes on the audio clock just before it, so the song stops and starts on the beat.
    const loop = this.cfg.loop;
    const nextLine = Math.min(this.starts[bar] ?? Infinity, loop && loop.end > t ? loop.end : Infinity);
    if (Number.isFinite(nextLine) && nextLine - t < 0.25 && this.quietScheduled !== nextLine) {
      this.quietScheduled = nextLine;
      if (q.quietAt(1) !== q.quiet) this.transport.setGainAt(q.quietAt(1) ? 0 : 1, this.transport.audioTimeAtPosition(nextLine + this.cfg.meta.offset));
    }
    if (this.quietReportDue && t >= this.quietReportDue.at) {
      const report = q.report(this.quietReportDue.firstLoud);
      this.quietReportDue = null;
      if (report) this.cb.onQuietReport?.(report);
    }
  }

  /** End the session now with whatever has been played (debugging / the e2e test). */
  finishNow(): void {
    this.finish();
  }

  private onAudioEnded(): void {
    if (this.paused || !this.running) return;
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const summary = this.judge.summary();
    this.stop();
    this.cb.onFinish?.(summary);
  }
}

/** Beat/bar markers across the chart from its tempo map + time signatures. */
export function computeBeats(chart: Chart, untilSeconds: number): BeatMark[] {
  const out: BeatMark[] = [];
  const ppq = chart.ppq;
  const sigs = chart.timeSignatures.length ? chart.timeSignatures : [{ tick: 0, numerator: 4, denominator: 4 }];
  const end = Math.max(untilSeconds, chart.duration) + 4;
  let tick = 0;
  let beatInBar = 0;
  let guard = 0;
  while (guard++ < 200000) {
    let sig = sigs[0];
    for (const s of sigs) if (s.tick <= tick) sig = s;
    const beatTicks = (ppq * 4) / sig.denominator;
    const time = ticksToSeconds(tick, chart.tempoMap, ppq);
    if (time > end) break;
    out.push({ time, bar: beatInBar === 0 });
    beatInBar = (beatInBar + 1) % sig.numerator;
    tick += beatTicks;
  }
  return out;
}

export const VOICE_ORDER_FOR_UI: DrumVoice[] = ['kick', 'snare', 'hihatClosed', 'hihatOpen', 'hihatPedal', 'tomHigh', 'tomMid', 'tomLow', 'ride', 'crash'];
