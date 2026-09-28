import type { App, Screen } from '@/app';
import { typingInField } from '@/app';
import { type Difficulty, type SongListEntry, type SongPackage } from '@/types';
import { loadSongFromZip, loadSongFromFiles, availableDifficulties, playableDifficulties } from '@/song';
import { h, append, button, toast, pickFile, pickFolder, clear, fmtScore, fmtTime } from './dom';
import { topbar } from './topbar';
import { attachPadNav } from './padNav';
import { drawProceduralArt } from './artwork';
import { applySongKit } from './game';
import { starString } from '@/game/scoring';
import { Transport } from '@/audio';

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD', expert: 'EXPERT' };
/** Practice speed presets — the 60 → 80 → 100 % ladder plus the steps around it. */
const PRACTICE_RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

export function songSelectScreen(app: App, params?: Record<string, unknown>): Screen {
  const practice = params?.practice === true;
  let entries: SongListEntry[] = [];
  let selected: SongListEntry | null = null;
  let difficulty: Difficulty = (localStorage.getItem('dk.lastDifficulty') as Difficulty) || 'medium';
  let rate = Number(localStorage.getItem('dk.practiceRate') ?? 1) || 1;
  let previewTransport: Transport | null = null;
  let previewToken = 0;

  const list = h('div', { class: 'songlist' });
  const detail = h('div', { class: 'panel' }, h('div', { class: 'dim' }, 'Select a song'));

  async function refresh(): Promise<void> {
    entries = await app.library.listAll();
    clear(list);
    if (!entries.length) list.appendChild(h('div', { class: 'dim' }, 'No songs yet. Import a song zip or create one in the Studio.'));
    for (const e of entries) {
      const art = h('div', { class: 'art' });
      if (e.artworkUrl) art.style.backgroundImage = `url("${e.artworkUrl}")`;
      else {
        const c = h('canvas', { width: 400, height: 250 });
        drawProceduralArt(c, e.meta);
        art.appendChild(c);
      }
      const best = app.scores.getBestAllDifficulties(e.meta.id);
      const bestAny = Object.values(best).sort((a, b) => b.score - a.score)[0];
      const card = h(
        'div',
        { class: 'songcard', style: { '--sa': e.meta.accent ?? '' }, onClick: () => select(e, card) },
        art,
        h('div', { class: 'tags' }, h('span', { class: 'pill' }, `${Math.round(e.meta.bpm)} BPM`), e.source !== 'bundled' ? h('span', { class: 'pill accent' }, 'IMPORTED') : null),
        bestAny ? h('div', { class: 'stars' }, starString(bestAny.stars)) : null,
        h('div', { class: 'meta' }, h('div', { class: 'title' }, e.meta.title), h('div', { class: 'artist' }, e.meta.artist)),
      );
      list.appendChild(card);
      if (selected?.meta.id === e.meta.id) card.classList.add('selected');
    }
  }

  async function select(e: SongListEntry, card: HTMLElement): Promise<void> {
    selected = e;
    list.querySelectorAll('.songcard').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    card.scrollIntoView({ block: 'nearest' });
    renderDetail();
    startPreview(e);
  }

  function selectBy(step: number): void {
    if (!entries.length) return;
    const i = selected ? entries.findIndex((x) => x.meta.id === selected!.meta.id) : -1;
    const next = Math.max(0, Math.min(entries.length - 1, i < 0 ? 0 : i + step));
    const card = list.children[next] as HTMLElement | undefined;
    if (card && entries[next] !== selected) select(entries[next], card);
  }

  function setDifficulty(d: Difficulty): void {
    difficulty = d;
    localStorage.setItem('dk.lastDifficulty', d);
    renderDetail();
  }

  function setRate(r: number): void {
    rate = r;
    localStorage.setItem('dk.practiceRate', String(r));
    renderDetail();
  }

  async function startPreview(e: SongListEntry): Promise<void> {
    const token = ++previewToken;
    stopPreview();
    try {
      await app.boot();
      const pkg = await app.library.load(e);
      if (token !== previewToken) return;
      // Pads audition the selected song's kit (custom samples or the default kit).
      applySongKit(app, pkg).catch((err) => console.warn('kit load failed', err));
      const audioBlob = pkg.files.get(pkg.meta.audio);
      if (!audioBlob) return;
      const buf = await app.engine.decode(await audioBlob.arrayBuffer());
      if (token !== previewToken) return;
      const t = new Transport(app.engine);
      t.load(buf);
      const start = e.meta.preview?.start ?? Math.min(30, buf.duration * 0.3);
      t.play(start);
      previewTransport = t;
      const len = e.meta.preview?.length ?? 20;
      setTimeout(() => {
        if (previewTransport === t) stopPreview();
      }, len * 1000);
    } catch (err) {
      console.warn('preview failed', err);
    }
  }

  function stopPreview(): void {
    previewTransport?.stop();
    previewTransport = null;
  }

  /** Load the song's kit without starting the audio preview (auto-select on screen open). */
  async function loadKit(e: SongListEntry): Promise<void> {
    if (!app.booted) return; // pads can't fire before boot; play/preview loads the kit later
    const token = ++previewToken;
    try {
      const pkg = await app.library.load(e);
      if (token !== previewToken) return;
      await applySongKit(app, pkg);
    } catch (err) {
      console.warn('kit load failed', err);
    }
  }

  function renderDetail(): void {
    clear(detail);
    if (!selected) return;
    const e = selected;
    const best = app.scores.getBestAllDifficulties(e.meta.id);
    const diffs = h('div', { class: 'diffs' });
    // Availability: up to the hardest chart listed in meta; easier ones are auto-derived, harder ones are not offered.
    const explicit = new Set(Object.keys(e.meta.charts ?? {}));
    const playable = playableDifficulties(e.meta);
    if (playable.length && !playable.includes(difficulty)) difficulty = playable[playable.length - 1];
    for (const d of playable) {
      const b = best[d];
      const btn = h(
        'div',
        { class: `diff ${d === difficulty ? 'selected' : ''} ${explicit.has(d) ? '' : 'derived'}`, dataset: { d }, title: explicit.has(d) ? '' : 'AUTO: thinned out from the hardest chart', onClick: () => setDifficulty(d) },
        DIFF_LABEL[d],
        h('span', { class: 'best' }, b ? `${fmtScore(b.score)} · ${starString(b.stars)}` : '—'),
      );
      diffs.appendChild(btn);
    }
    const top = app.scores.getTop(e.meta.id, difficulty, 5);
    const lb = h(
      'table',
      { class: 'leaderboard' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Player'), h('th', null, 'Score'), h('th', null, 'Acc'), h('th', null, 'Combo'))),
      h('tbody', null, top.length ? top.map((s, i) => h('tr', null, h('td', null, String(i + 1)), h('td', null, s.player), h('td', null, fmtScore(s.score)), h('td', null, `${(s.accuracy * 100).toFixed(1)}%`), h('td', null, `${s.maxCombo}${s.fullCombo ? ' FC' : ''}`))) : h('tr', null, h('td', { colSpan: 5, class: 'mute' }, 'No scores yet — be the first.'))),
    );
    const canPlay = playable.length > 0;
    const bpmAt = Math.round(e.meta.bpm * rate);
    const playBtn = Object.assign(button([h('span', null, h('kbd', null, practice ? 'P' : '↵'), ' PLAY'), h('span', { class: 'hint' }, 'full song · scored')], () => play(e, 'play'), `${practice ? '' : 'primary'} big`), { disabled: !canPlay });
    const practiceBtn = Object.assign(button([h('span', null, h('kbd', null, practice ? '↵' : 'P'), ` PRACTICE ${Math.round(rate * 100)}%`), h('span', { class: 'hint' }, `${bpmAt} BPM · loop the hard bars`)], () => play(e, 'practice'), `${practice ? 'primary' : ''} big`), { disabled: !canPlay });
    const rates = h('div', { class: 'rate-chips' }, ...PRACTICE_RATES.map((r) => h('button', { class: `chip ${Math.abs(r - rate) < 0.001 ? 'on' : ''}`, onClick: () => setRate(r) }, `${Math.round(r * 100)}%`)));
    append(detail, [
      h('h2', { class: 'display' }, e.meta.title),
      h('div', { class: 'dim' }, `${e.meta.artist}${e.meta.album ? ' · ' + e.meta.album : ''}${e.meta.year ? ' · ' + e.meta.year : ''}`),
      h('div', { class: 'row', style: { marginTop: '10px', gap: '8px' } }, h('span', { class: 'pill' }, `${Math.round(e.meta.bpm)} BPM`), e.meta.length ? h('span', { class: 'pill' }, fmtTime(e.meta.length)) : null, e.meta.charter ? h('span', { class: 'pill' }, `chart: ${e.meta.charter}`) : null, e.meta.samples && Object.keys(e.meta.samples).length ? h('span', { class: 'pill accent' }, 'custom kit') : null),
      h('h3', null, 'Difficulty'),
      canPlay ? diffs : h('div', { class: 'hint-box' }, 'This song has no chart yet. Open it in the Studio to record or draw one.'),
      canPlay && playable.some((d) => !explicit.has(d)) ? h('div', { class: 'small mute', style: { marginTop: '6px' } }, 'AUTO = thinned out from the hardest chart in the song folder.') : null,
      h('div', { class: 'launch' },
        playBtn,
        practiceBtn,
        h('div', { class: 'rates' }, h('span', { class: 'small dim' }, 'Practice speed'), rates),
      ),
      h('h3', null, `Leaderboard · ${difficulty}`),
      lb,
      h('div', { class: 'small mute', style: { marginTop: '14px' } }, h('kbd', null, '←'), h('kbd', null, '→'), ' song  ', h('kbd', null, '1'), '–', h('kbd', null, '4'), ' difficulty  ', h('kbd', null, 'Esc'), ' back'),
      e.source !== 'bundled' ? h('div', { class: 'btn-row', style: { marginTop: '14px' } }, button('REMOVE FROM LIBRARY', () => remove(e), 'danger small icon')) : null,
    ]);
  }

  async function play(e: SongListEntry, mode: 'play' | 'practice'): Promise<void> {
    stopPreview();
    await app.boot();
    try {
      const pkg = await app.library.load(e);
      app.navigate('game', { pkg, difficulty, mode, rate: mode === 'practice' ? rate : 1 });
    } catch (err) {
      toast(`Could not load song: ${(err as Error).message}`, 'bad');
    }
  }

  async function remove(e: SongListEntry): Promise<void> {
    if (!confirm(`Remove "${e.meta.title}" from your library? High scores are kept.`)) return;
    await app.library.remove(e.meta.id);
    selected = null;
    clear(detail);
    detail.appendChild(h('div', { class: 'dim' }, 'Select a song'));
    await refresh();
  }

  async function importPkg(pkg: SongPackage): Promise<void> {
    if (!availableDifficulties(pkg).length) {
      toast('That song has no chart MIDI files (expert.mid etc). Open it in the Studio to record or draw one.', 'bad');
    }
    await app.library.import(pkg);
    toast(`Imported "${pkg.meta.title}"`, 'ok');
    await refresh();
  }

  async function importZip(): Promise<void> {
    const files = await pickFile('.zip,application/zip', true);
    for (const f of files) {
      try {
        await importPkg(await loadSongFromZip(f));
      } catch (err) {
        toast(`${f.name}: ${(err as Error).message}`, 'bad');
      }
    }
  }

  async function importFolder(): Promise<void> {
    const files = await pickFolder();
    if (!files.length) return;
    try {
      await importPkg(await loadSongFromFiles(files));
    } catch (err) {
      toast(`${(err as Error).message}`, 'bad');
    }
  }

  // drag & drop zips anywhere
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    document.body.classList.add('dragover');
  };
  const onDragLeave = () => document.body.classList.remove('dragover');
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    document.body.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const f of files) {
      if (!/\.zip$/i.test(f.name)) continue;
      try {
        await importPkg(await loadSongFromZip(f));
      } catch (err) {
        toast(`${f.name}: ${(err as Error).message}`, 'bad');
      }
    }
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);

  // Hitting a pad plays the selected song's kit so you can try the samples before playing.
  const unsubHits = app.input.onHit((hit) => {
    if (app.settings.drumSoundsOnHit) app.kit.trigger(hit.voice, hit.velocity);
  });

  const onKey = (ev: KeyboardEvent) => {
    if (typingInField(ev) || ev.metaKey || ev.ctrlKey || ev.altKey || document.querySelector('.modal-back')) return;
    if (ev.code === 'Enter' && (ev.target as HTMLElement | null)?.closest?.('button')) return; // a focused button handles its own Enter
    // Drum keys belong to the kit audition; everything below is unbound by default.
    if (Object.values(app.settings.keyboard).some((codes) => codes.includes(ev.code))) return;
    const e = selected;
    const playable = e ? playableDifficulties(e.meta) : [];
    const digit = /^Digit([1-4])$/.exec(ev.code);
    if (ev.code === 'ArrowLeft' || ev.code === 'ArrowUp') selectBy(-1);
    else if (ev.code === 'ArrowRight' || ev.code === 'ArrowDown') selectBy(1);
    else if (digit) {
      const d = (['easy', 'medium', 'hard', 'expert'] as Difficulty[])[Number(digit[1]) - 1];
      if (playable.includes(d)) setDifficulty(d);
    } else if (ev.code === 'Enter' && e && playable.length) play(e, practice ? 'practice' : 'play');
    else if (ev.code === 'KeyP' && e && playable.length) play(e, practice ? 'play' : 'practice');
    else if (ev.code === 'Escape') app.navigate('title');
    else return;
    ev.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  // Pads: ▲▼ change song, floor tom ×2 starts it, crash ×2 back to the title.
  const pads = attachPadNav(app, () => ({
    prev: () => selectBy(-1),
    next: () => selectBy(1),
    select: () => {
      if (selected && playableDifficulties(selected.meta).length) play(selected, practice ? 'practice' : 'play');
    },
    selectLabel: () => (practice ? `PRACTICE ${Math.round(rate * 100)}%` : 'PLAY'),
    back: () => app.navigate('title'),
    backLabel: 'TITLE',
  }));

  const el = h(
    'div',
    { class: 'screen' },
    topbar(app, practice ? 'PRACTICE' : 'SONGS', button('IMPORT ZIP', importZip), button('IMPORT FOLDER', importFolder), button('BACK', () => app.navigate('title'), 'ghost')),
    h('div', { class: 'screen-body' }, h('div', { class: 'song-select' }, list, detail)),
  );
  refresh().then(() => {
    // auto-select last played song
    const lastId = localStorage.getItem('dk.lastSong');
    const e = entries.find((x) => x.meta.id === lastId) ?? entries[0];
    if (e) {
      const card = list.children[entries.indexOf(e)] as HTMLElement | undefined;
      if (card) {
        selected = e;
        card.classList.add('selected');
        renderDetail();
        loadKit(e);
      }
    }
  });
  return {
    el,
    dispose: () => {
      stopPreview();
      previewToken++;
      unsubHits();
      window.removeEventListener('keydown', onKey);
      pads.dispose();
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    },
  };
}
