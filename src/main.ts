import { App, LINKABLE_SCREENS } from './app';
import { h } from './ui/dom';
import { titleScreen } from './ui/title';
import { songSelectScreen } from './ui/songselect';
import { gameScreen } from './ui/game';
import { resultsScreen } from './ui/results';
import { wizardScreen } from './ui/wizard';
import { settingsScreen } from './ui/settings';
import { studioScreen } from './ui/studio';

const root = document.getElementById('app')!;
root.appendChild(h('div', { class: 'backdrop' }));
const app = new App(root);
app.register('title', titleScreen);
app.register('songs', (a) => songSelectScreen(a, { practice: false }));
app.register('songs-practice', (a) => songSelectScreen(a, { practice: true }));
app.register('game', gameScreen);
app.register('results', resultsScreen);
app.register('wizard', wizardScreen);
app.register('settings', settingsScreen);
app.register('studio', studioScreen);

// Deep-linkable top-level screens (game/results need params, so they fall back to title).
const hashScreen = () => {
  const name = location.hash.replace('#', '');
  return LINKABLE_SCREENS.includes(name) ? name : 'title';
};
app.navigate(hashScreen());

// Browser Back / Forward: follow the hash. navigate() itself updates the hash, so skip the echo.
// Forward onto a spent #game / #results entry can't be rebuilt without its params: stay put.
window.addEventListener('hashchange', () => {
  const name = location.hash.replace('#', '');
  if (name === app.currentName) return;
  if (LINKABLE_SCREENS.includes(name)) app.navigate(name);
  else history.replaceState(null, '', `#${app.currentName}`);
});

// Expose for debugging / automated tests.
(window as unknown as { dk: App }).dk = app;
