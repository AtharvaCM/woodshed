import type { App, Screen } from '@/app';
import { typingInField } from '@/app';
import { barAccuracy, barStats, weakestSpan, type BarNote } from '@/game/bars';
import type { Difficulty, HighScore, HitWindows, ScoreSummary, SongPackage } from '@/types';
import { h, button, fmtScore, pct, downloadBlob } from './dom';
import { fileExtensionFor, type RecordedVideo } from '@/game/videoRecorder';
import { topbar } from './topbar';
import { attachPadNav, focusList } from './padNav';
import { hitWindowsFor, starString, verdictFor } from '@/game/scoring';
import { drawTimingHeatmap, timingSummary, type TimingHit } from '@/game/timingHeatmap';
import type { DrumGroup, Feel, Lean } from '@/game/feel';
import type { PracticeEntry } from '@/store';

/** How many recent takes and passes the history panel draws. */
const HISTORY_SHOWN = 30;

/**
 * Spread over your recent takes and passes of this song and difficulty, oldest left: a line that should fall
 * as the part settles in. The last few are listed with their bars, speed, hits and where they sat.
 */
function historyPanel(entries: PracticeEntry[]): HTMLElement | null {
  const timed = entries.filter((e) => e.all).slice(-HISTORY_SHOWN);
  if (timed.length < 2) return null;
  const spreads = timed.map((e) => ms(e.all!.spread));
  const lo = Math.min(...spreads);
  const hi = Math.max(...spreads);
  const W = 300;
  const H = 64;
  const x = (i: number) => (i / (timed.length - 1)) * W;
  const y = (v: number) => (hi === lo ? H / 2 : 6 + ((hi - v) / (hi - lo)) * (H - 12));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.add('history-spark');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', spreads.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  svg.appendChild(line);
  spreads.forEach((v, i) => {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(i).toFixed(1));
    dot.setAttribute('cy', y(v).toFixed(1));
    dot.setAttribute('r', i === spreads.length - 1 ? '3.5' : '2');
    if (timed[i].kind === 'take') dot.classList.add('take');
    svg.appendChild(dot);
  });
  const best = Math.min(...spreads);
  const label = (e: PracticeEntry) => e.section ?? (e.bars.first === 1 && e.kind === 'take' ? 'whole song' : `bars ${e.bars.first}–${e.bars.last}`);
  const when = (d: number) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const recent = timed.slice(-5).reverse();
  return h('div', { class: 'history' },
    h('h3', null, 'Progress'),
    h('div', { class: 'small dim' }, `Spread over your last ${timed.length} takes and passes at this difficulty (lower is steadier; big dots are whole takes): ${spreads[0]} → ${spreads[spreads.length - 1]} ms, best ${best} ms.`),
    svg,
    h('table', { class: 'leaderboard feel-table' },
      h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'What'), h('th', null, 'Speed'), h('th', null, 'Hit'), h('th', null, 'Sits'), h('th', null, 'Spread'))),
      h('tbody', null, ...recent.map((e) => h('tr', null,
        h('td', { class: 'mute' }, when(e.date)),
        h('td', null, label(e)),
        h('td', null, `${Math.round(e.rate * 100)}%`),
        h('td', null, `${Math.round((1 - e.missed / Math.max(1, e.notes)) * 100)}%`),
        h('td', null, leanSpan(e.all!.lean)),
        h('td', null, `${ms(e.all!.spread)} ms`),
      ))),
    ),
  );
}

/** A section this much ahead of or behind the take's overall lean is rushing or dragging. */
const DRIFT_MS = 10;
const GROUP_LABEL: Record<DrumGroup, string> = { kick: 'Kick', snare: 'Snare', hats: 'Hi-hat', toms: 'Toms', cymbals: 'Ride & crash' };
const ms = (s: number) => Math.round(s * 1000);
/** "12 ms ahead", "8 ms behind", or "on the beat" within 3 ms. */
const where = (lean: number) => (Math.abs(ms(lean)) < 3 ? 'on the beat' : `${Math.abs(ms(lean))} ms ${lean < 0 ? 'ahead' : 'behind'}`);
const leanSpan = (lean: number) => h('span', { class: `lean ${Math.abs(ms(lean)) < 3 ? '' : lean < 0 ? 'ahead' : 'behind'}` }, where(lean));

/** The "Timing & feel" panel: where the take sits against the beat, drum by drum and section by section. */
function feelPanel(feel: Feel, practice: (span: { first: number; last: number }) => void, practiceRate: number): HTMLElement | null {
  const all = feel.all;
  if (!all) return null;
  const row = (label: HTMLElement | string, l: Lean, extra?: HTMLElement | null) =>
    h('tr', null, h('td', null, label), h('td', null, leanSpan(l.lean)), h('td', null, `${ms(l.spread)} ms`), h('td', { class: 'mute' }, String(l.count)), h('td', null, extra ?? null));
  const head = (first: string) => h('thead', null, h('tr', null, h('th', null, first), h('th', null, 'Sits'), h('th', null, 'Spread'), h('th', null, 'Hits'), h('th', null, '')));
  const drift = (l: Lean) => {
    const d = ms(l.lean - all.lean);
    return Math.abs(d) >= DRIFT_MS ? h('span', { class: `pill ${d < 0 ? 'warn' : 'bad'}` }, d < 0 ? `rushing ${-d} ms` : `dragging ${d} ms`) : null;
  };
  const k = feel.kickVsHands;
  const dyn = feel.dynamics;
  return h('div', { class: 'feel' },
    h('h3', null, 'Timing & feel'),
    h('div', { class: 'mono' }, 'You sit ', leanSpan(all.lean), ` · spread ${ms(all.spread)} ms`),
    h('div', { class: 'small dim', style: { marginBottom: '8px' } }, 'Sits = your median timing against the chart (ahead = early). Spread = how wide the middle half of your hits lands: smaller is steadier.'),
    feel.byDrum.length ? h('table', { class: 'leaderboard feel-table' }, head('Drum'), h('tbody', null, ...feel.byDrum.map((d) => row(GROUP_LABEL[d.group], d)))) : null,
    k ? h('div', { class: 'small', style: { margin: '8px 0' } }, Math.abs(ms(k.gap)) < 3 ? `Kick and hands land together on shared beats (${k.count} beats).` : `On shared beats your kick lands ${Math.abs(ms(k.gap))} ms ${k.gap > 0 ? 'after' : 'before'} your hands (${k.count} beats).`) : null,
    feel.bySection.length ? h('table', { class: 'leaderboard feel-table' }, head('Section'), h('tbody', null, ...feel.bySection.map((s) => row(h('span', null, s.name, h('span', { class: 'mute' }, ` ${s.first}–${s.last}`)), s, drift(s))))) : null,
    feel.loosest
      ? h('div', { class: 'row', style: { marginTop: '10px', gap: '10px' } },
          h('div', { class: 'small' }, `Loosest 4 bars: ${feel.loosest.first}–${feel.loosest.last}, spread ${ms(feel.loosest.spread)} ms.`),
          button(`PRACTICE THEM AT ${Math.round(practiceRate * 100)}%`, () => practice(feel.loosest!), 'small'))
      : null,
    dyn ? h('div', { class: 'small', style: { marginTop: '8px' } }, `Ghost notes at ${Math.round((dyn.ghost / Math.max(1e-6, dyn.backbeat)) * 100)}% of your backbeat (velocity ${Math.round(dyn.ghost * 127)} against ${Math.round(dyn.backbeat * 127)}; ${dyn.ghosts} ghosts, ${dyn.backbeats} backbeats).`) : null,
  );
}

export function resultsScreen(app: App, params?: Record<string, unknown>): Screen {
  const pkg = params?.pkg as SongPackage;
  const difficulty = params?.difficulty as Difficulty;
  const mode = params?.mode as string;
  const summary = params?.summary as ScoreSummary;
  const rate = (params?.rate as number) ?? 1;
  const timing = (params?.timing as { mean: number; count: number } | undefined) ?? { mean: 0, count: 0 };
  const suggestedOffset = Math.round((app.settings.inputOffset - timing.mean) * 1000);
  const showTiming = timing.count >= 4;
  const timingBox: HTMLElement | null = showTiming
    ? h('div', { class: 'hint-box', style: { marginTop: '16px' } },
        h('div', null, `Timing: your hits averaged ${Math.round(Math.abs(timing.mean) * 1000)} ms ${timing.mean > 0 ? 'LATE' : 'EARLY'} (${timing.count} hits, offset ${Math.round(app.settings.inputOffset * 1000)} ms).`),
        Math.abs(timing.mean) > 0.015
          ? h('div', { class: 'btn-row', style: { marginTop: '8px' } }, button(`SET INPUT OFFSET TO ${suggestedOffset} MS`, () => { app.settingsStore.update({ inputOffset: suggestedOffset / 1000 }); timingBox?.replaceChildren(h('span', { class: 'pill ok' }, `Input offset set to ${suggestedOffset} ms`)); }, 'primary small'))
          : h('div', { class: 'small dim' }, 'Nice — your timing offset is dialled in.'),
      )
    : null;
  // Timing heatmap: every judged hit at the strike line, early above / late below.
  const hits = (params?.hits as TimingHit[] | undefined) ?? [];
  const windows = (params?.windows as HitWindows | undefined) ?? hitWindowsFor(difficulty, app.settings.hitWindowScale);
  let heatBox: HTMLElement | null = null;
  let heatObserver: ResizeObserver | null = null;
  if (hits.length) {
    const ts = timingSummary(hits);
    const ms = (s: number) => `${s > 0 ? '+' : ''}${Math.round(s * 1000)} ms`;
    const heatCanvas = h('canvas', { class: 'heatmap-canvas' });
    const redraw = () => drawTimingHeatmap(heatCanvas, { hits, windows, laneOrder: app.settings.laneOrder });
    heatObserver = new ResizeObserver(redraw);
    heatObserver.observe(heatCanvas);
    heatBox = h('div', { class: 'heatmap' },
      h('div', { class: 'small dim', style: { marginBottom: '6px' } }, 'TIMING HEATMAP — every hit piled up where it landed on the strike line: above = early, below = late'),
      heatCanvas,
      h('div', { class: 'legend' },
        h('span', null, h('span', { class: 'swatch' }), 'fewer → more hits'),
        h('span', null, `${ts.count} hits · mean ${ms(ts.mean)} · spread ±${Math.round(ts.spread * 1000)} ms`),
        h('span', null, `${Math.round((ts.early / ts.count) * 100)}% early · ${Math.round((ts.late / ts.count) * 100)}% late`),
      ),
    );
  }
  // Performance video. It arrives either finished or as a promise (the recorder is still adding the
  // closing results card): show a placeholder until it is ready. It sits at the bottom of the left column.
  const videoParam = params?.video as RecordedVideo | Promise<RecordedVideo | undefined> | undefined;
  let videoUrl: string | null = null;
  let disposed = false;
  const videoSlot = h('div', { class: 'video-slot' });
  const showVideo = (video: RecordedVideo) => {
    videoUrl = URL.createObjectURL(video.blob);
    const ext = fileExtensionFor(video.mimeType);
    const safe = (t: string) => t.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'song';
    const filename = `woodshed-${safe(pkg.meta.title)}-${difficulty}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.${ext}`;
    const mb = (video.blob.size / 1_048_576).toFixed(1);
    videoSlot.replaceChildren(h('div', { class: 'video-box', style: { marginTop: '24px' } },
      h('video', { src: videoUrl, controls: true, playsInline: true, preload: 'metadata' }),
      h('div', { class: 'btn-row', style: { marginTop: '10px' } },
        button(`SAVE VIDEO (${mb} MB)`, () => downloadBlob(video.blob, filename), 'primary'),
        h('span', { class: 'small dim' }, `${video.width}×${video.height} · ${Math.round(video.duration)}s · ${ext.toUpperCase()}${ext === 'webm' ? ' — plays in Chrome/Firefox/VLC' : ''}`),
      ),
    ));
  };
  if (videoParam instanceof Promise) {
    videoSlot.appendChild(h('div', { class: 'video-box pending', style: { marginTop: '24px' } }, h('span', { class: 'spinner' }), h('span', { class: 'dim' }, 'Finishing the video — adding the results card…')));
    videoParam.then(
      (v) => {
        if (disposed) return;
        if (v && v.blob.size) showVideo(v);
        else videoSlot.replaceChildren();
      },
      () => videoSlot.replaceChildren(),
    );
  } else if (videoParam && videoParam.blob.size) {
    showVideo(videoParam);
  }
  const saved = mode === 'play';
  const prevBest = app.scores.getBest(pkg.meta.id, difficulty);
  let rankInfo: { rank: number; isNewBest: boolean } | null = null;
  const entry: HighScore = { ...summary, songId: pkg.meta.id, difficulty, player: app.settings.playerName || 'PLAYER', date: Date.now() };
  if (saved && summary.totalNotes > 0) rankInfo = app.scores.submit(entry);

  const top = app.scores.getTop(pkg.meta.id, difficulty, 10);
  const total = Math.max(1, summary.totalNotes);
  const bar = (label: string, n: number, color: string) => h('div', { class: 'jb' }, h('span', null, label), h('div', { class: 'bar' }, h('div', { style: { width: `${(n / total) * 100}%`, background: color } })), h('span', { style: { textAlign: 'right' } }, String(n)));

  const verdict = verdictFor(summary);
  const hitCount = summary.hits.perfect + summary.hits.great + summary.hits.good;

  // ── Where it slipped: accuracy per bar, and the weakest 4-bar stretch to loop in practice ──
  const barsParam = params?.bars as { notes: BarNote[]; starts: number[]; lastBar: number } | undefined;
  const stats = barsParam && barsParam.lastBar > 1 ? barStats(barsParam.notes, barsParam.starts, barsParam.lastBar) : [];
  const weakest = weakestSpan(stats, 4);
  const storedRate = Number(localStorage.getItem('dk.practiceRate')) || 0;
  const practiceRate = storedRate && storedRate < 1 ? storedRate : 0.8;
  let pick = weakest && weakest.accuracy < 0.999 ? { first: weakest.first, last: weakest.last } : null;
  const practiceBars = (span: { first: number; last: number }) =>
    app.navigate('game', { pkg, difficulty, mode: 'practice', rate: practiceRate, loop: span, back: params?.back });
  let slipBox: HTMLElement | null = null;
  const feelParam = params?.feel as Feel | undefined;
  if (stats.some((b) => b.notes)) {
    const cells = stats.map((b) => {
      const acc = barAccuracy(b);
      const cell = h('div', {
        class: `cell ${b.notes ? '' : 'empty'}`,
        title: b.notes ? `Bar ${b.bar} · ${b.notes - b.missed}/${b.notes} hit · ${Math.round(acc * 100)}%` : `Bar ${b.bar} · no notes`,
        style: b.notes ? { background: `hsl(${Math.round(Math.max(0, acc) * 120)} 85% ${acc > 0.97 ? 38 : 52}%)` } : {},
        onClick: () => { if (b.notes) { pick = { first: b.bar, last: Math.min(stats.length, b.bar + 3) }; renderPick(); } },
      });
      return cell;
    });
    const ticks = h('div', { class: 'ticks' }, ...stats.filter((b) => b.bar === 1 || b.bar % 8 === 1).map((b) => h('span', { style: { left: `${((b.bar - 1) / stats.length) * 100}%` } }, String(b.bar))));
    const pickInfo = h('div', { class: 'pick' });
    const strip = h('div', { class: 'bar-strip' }, ...cells);
    const renderPick = () => {
      cells.forEach((c, i) => c.classList.toggle('sel', !!pick && i + 1 >= pick.first && i + 1 <= pick.last));
      strip.classList.toggle('has-sel', !!pick);
      if (!pick) {
        pickInfo.replaceChildren(h('span', { class: 'pill ok' }, 'Clean all the way through'), h('span', { class: 'small dim' }, 'Click any bar to loop it anyway.'));
        return;
      }
      const span = stats.slice(pick.first - 1, pick.last);
      const n = span.reduce((a, b) => a + b.notes, 0);
      const pts = span.reduce((a, b) => a + b.points, 0);
      const missed = span.reduce((a, b) => a + b.missed, 0);
      const current = pick;
      pickInfo.replaceChildren(
        h('div', null,
          h('div', { class: 'mono' }, `BARS ${current.first}–${current.last} · ${n ? Math.round((pts / n) * 100) : 0}% · ${missed} missed`),
          h('div', { class: 'small dim' }, weakest && current.first === weakest.first ? 'Your weakest stretch this take.' : 'Selected stretch.'),
        ),
        button([h('kbd', null, 'P'), ` PRACTICE AT ${Math.round(practiceRate * 100)}%`], () => practiceBars(current), 'primary small'),
      );
    };
    slipBox = h('div', { class: 'slips' },
      h('h3', { style: { marginTop: 0 } }, 'Where it slipped'),
      h('div', { class: 'small dim', style: { marginBottom: '8px' } }, 'One block per bar: green = clean, red = missed. Click a bar to pick the 4 bars from there.'),
      strip,
      ticks,
      pickInfo,
    );
    renderPick();
  }

  const el = h(
    'div',
    { class: 'screen' },
    topbar(app, 'RESULTS'),
    h(
      'div',
      { class: 'screen-body center' },
      h(
        'div',
        { class: 'results' },
        h(
          'div',
          { class: 'panel' },
          h('div', { class: 'dim' }, `${pkg.meta.title} — ${pkg.meta.artist} · ${difficulty.toUpperCase()}${mode === 'practice' ? ` · PRACTICE ${Math.round(rate * 100)}%` : ''}`),
          h('h2', { class: 'display', style: { marginTop: '6px' } }, verdict),
          h('div', { class: 'big-score' }, fmtScore(summary.score)),
          h('div', { class: 'stars-big' }, starString(summary.stars)),
          summary.fullCombo ? h('div', { style: { marginTop: '10px' } }, h('span', { class: 'fc-badge' }, 'FULL COMBO')) : null,
          rankInfo?.isNewBest ? h('div', { style: { marginTop: '10px' } }, h('span', { class: 'pill accent' }, prevBest ? `NEW PERSONAL BEST · was ${pct(prevBest.accuracy)}` : 'FIRST CLEAR · NEW PERSONAL BEST')) : null,
          saved && prevBest && !rankInfo?.isNewBest ? h('div', { class: 'small dim', style: { marginTop: '10px' } }, `Personal best ${fmtScore(prevBest.score)} · ${pct(prevBest.accuracy)} (${pct(Math.abs(summary.accuracy - prevBest.accuracy))} ${summary.accuracy >= prevBest.accuracy ? 'above' : 'below'} on accuracy)`) : null,
          !saved ? h('div', { style: { marginTop: '10px' } }, h('span', { class: 'pill warn' }, 'PRACTICE — SCORE NOT SAVED')) : null,
          h('div', { class: 'grid-3', style: { marginTop: '20px' } },
            h('div', { class: 'stat' }, h('div', { class: 'v' }, pct(summary.accuracy)), h('div', { class: 'k' }, 'Accuracy')),
            h('div', { class: 'stat' }, h('div', { class: 'v' }, String(summary.maxCombo)), h('div', { class: 'k' }, 'Max combo')),
            h('div', { class: 'stat' }, h('div', { class: 'v' }, `${hitCount}/${summary.totalNotes}`), h('div', { class: 'k' }, 'Notes hit')),
          ),
          h('div', { class: 'judge-bars' },
            bar('PERFECT', summary.hits.perfect, 'var(--perfect)'),
            bar('GREAT', summary.hits.great, 'var(--great)'),
            bar('GOOD', summary.hits.good, 'var(--good)'),
            bar('MISS', summary.hits.miss, 'var(--miss)'),
          ),
          heatBox,
          timingBox,
          h('div', { class: 'btn-row', style: { marginTop: '24px' } },
            button([h('kbd', null, '↵'), ' PLAY AGAIN'], () => app.navigate('game', { pkg, difficulty, mode, rate, back: params?.back }), 'primary'),
            params?.back === 'studio' ? button('BACK TO STUDIO', () => app.navigate('studio')) : null,
            button([h('kbd', null, 'Esc'), ' SONG LIST'], () => app.navigate(mode === 'practice' ? 'songs-practice' : 'songs')),
            button('TITLE', () => app.navigate('title'), 'ghost'),
          ),
          videoSlot,
        ),
        h(
          'div',
          { class: 'panel' },
          slipBox,
          feelParam ? feelPanel(feelParam, practiceBars, practiceRate) : null,
          historyPanel(app.practiceLog.list({ songId: pkg.meta.id, difficulty })),
          h('h3', { style: slipBox ? {} : { marginTop: 0 } }, `Leaderboard · ${difficulty}`),
          h('table', { class: 'leaderboard' },
            h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Player'), h('th', null, 'Score'), h('th', null, 'Acc'), h('th', null, 'Combo'), h('th', null, 'Date'))),
            h('tbody', null, top.length ? top.map((s, i) => h('tr', { class: rankInfo && i === rankInfo.rank - 1 && s.date === entry.date ? 'you' : '' }, h('td', null, String(i + 1)), h('td', null, s.player), h('td', null, fmtScore(s.score)), h('td', null, pct(s.accuracy)), h('td', null, `${s.maxCombo}${s.fullCombo ? ' FC' : ''}`), h('td', null, new Date(s.date).toLocaleDateString()))) : h('tr', null, h('td', { colSpan: 6, class: 'mute' }, 'No saved scores yet.'))),
          ),
        ),
      ),
    ),
  );
  const onKey = (e: KeyboardEvent) => {
    if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Enter' && !(e.target as HTMLElement | null)?.closest?.('button')) app.navigate('game', { pkg, difficulty, mode, rate, back: params?.back });
    else if (e.code === 'KeyP' && pick) practiceBars(pick);
    else if (e.code === 'Escape') app.navigate(params?.back === 'studio' ? 'studio' : mode === 'practice' ? 'songs-practice' : 'songs');
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  // Pads: ▲▼ through the actions (play again, practice the slipped bars…), crash ×2 to the song list.
  const actionFocus = focusList(
    () => Array.from(el.querySelectorAll<HTMLElement>('.btn')),
    () => el.querySelector<HTMLElement>('.btn-row .btn.primary'),
  );
  const pads = attachPadNav(app, () => ({
    ...actionFocus,
    back: () => app.navigate(params?.back === 'studio' ? 'studio' : mode === 'practice' ? 'songs-practice' : 'songs'),
    backLabel: params?.back === 'studio' ? 'STUDIO' : 'SONG LIST',
  }));

  return {
    el,
    dispose: () => {
      window.removeEventListener('keydown', onKey);
      pads.dispose();
      disposed = true;
      heatObserver?.disconnect();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
  };
}
