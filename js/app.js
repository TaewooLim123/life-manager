// App shell: routing, rendering, event delegation, keyboard shortcuts, service worker.
import { store } from './store.js';
import { renderToday, renderSchool, renderTasks, renderHabits, renderWeek } from './views.js';
import { initSheet, openSheet, closeSheet, isSheetOpen, rerenderSettings } from './sheet.js';
import { toggleCheck, loadSample } from './model.js';
import { icons } from './icons.js';
import { initSync, onSyncState, syncState } from './sync.js';
import { parseQuick, uid, todayISO } from './util.js';

const TABS = [
  ['today', 'Today', renderToday],
  ['school', 'School', renderSchool],
  ['tasks', 'Tasks', renderTasks],
  ['habits', 'Habits', renderHabits],
  ['week', 'Week', renderWeek],
];
// What the + button creates on each tab.
const ADD_DEFAULT = { today: 'assignment', school: 'assignment', tasks: 'task', habits: 'habit', week: 'block' };

const state = {
  tab: 'today',
  schoolView: localStorage.getItem('schoolView') || 'due',
  weekDay: null,
};

const main = document.getElementById('main');
const navSide = document.getElementById('nav-side');
const navBottom = document.getElementById('nav-bottom');
const syncSide = document.getElementById('sync-side');
const toastEl = document.getElementById('toast');

// ---------- theme ----------
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

// ---------- nav ----------
function renderNav() {
  navSide.innerHTML = TABS.map(([k, l], i) =>
    `<a class="nav-link" href="#${k}" ${state.tab === k ? 'aria-current="page"' : ''}>${icons[k]}${l}<span class="nav-num">${i + 1}</span></a>`).join('');
  navBottom.innerHTML = TABS.map(([k, l]) =>
    `<a class="tab" href="#${k}" ${state.tab === k ? 'aria-current="page"' : ''}><span class="tab-ico">${icons[k]}</span>${l}</a>`).join('');
}

function renderSync() {
  const s = syncState;
  let dot = '', label;
  if (!s.configured) label = 'On this device';
  else if (!s.signedIn) label = 'Sync: sign in';
  else if (s.status === 'syncing') { dot = 'busy'; label = 'Syncing…'; }
  else if (s.status === 'error') { dot = 'err'; label = 'Sync error'; }
  else if (s.status === 'offline') { label = 'Offline · saved'; }
  else { dot = 'ok'; label = 'Synced'; }
  syncSide.innerHTML = `<span class="sync-dot ${dot}"></span>${label}`;
}

// ---------- render ----------
function render({ keepScroll = true } = {}) {
  const tab = TABS.find(([k]) => k === state.tab) || TABS[0];
  const y = window.scrollY;
  // Keep any open <details> open across re-renders.
  const openDetails = [...main.querySelectorAll('details[open] summary')].map((s) => s.textContent.replace(/\(\d+\)/, ''));
  // Preserve a half-typed quick-add across re-renders (e.g. a sync arriving mid-typing).
  const q = main.querySelector('input[name="q"]');
  const qVal = q?.value, qFocus = q && document.activeElement === q;
  main.innerHTML = tab[2](state);
  const q2 = main.querySelector('input[name="q"]');
  if (q2 && qVal) q2.value = qVal;
  if (q2 && qFocus) q2.focus({ preventScroll: true });
  for (const s of main.querySelectorAll('details summary')) {
    if (openDetails.includes(s.textContent.replace(/\(\d+\)/, ''))) s.parentElement.open = true;
  }
  if (keepScroll) window.scrollTo(0, y);
}

function route() {
  const h = location.hash.slice(1);
  const next = TABS.some(([k]) => k === h) ? h : 'today';
  const changed = next !== state.tab;
  state.tab = next;
  renderNav();
  render({ keepScroll: !changed });
  if (changed) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span></span>${action ? `<button type="button">${action.label}</button>` : ''}`;
  toastEl.firstChild.textContent = msg;
  if (action) toastEl.querySelector('button').onclick = () => { action.fn(); toastEl.hidden = true; };
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? 5000 : 2200);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, kind } = el.dataset;
  const inSheet = !!el.closest('#sheet');
  const fromClass = inSheet && isSheetOpen() ? document.querySelector('#sheet [data-action="edit"][data-kind="class"]')?.dataset.id : null;

  switch (action) {
    case 'go': location.hash = el.dataset.tab; break;
    case 'add': {
      const type = el.dataset.type || ADD_DEFAULT[state.tab];
      const preset = el.dataset.class ? { classId: el.dataset.class, returnTo: el.dataset.class } : {};
      if (state.tab === 'school' && state.schoolView === 'classes' && !el.dataset.type && !inSheet) {
        openSheet({ mode: 'add', type: 'class', preset });
      } else openSheet({ mode: 'add', type, preset });
      break;
    }
    case 'edit':
      openSheet({ mode: 'edit', type: kind, id, preset: fromClass && kind !== 'class' ? { returnTo: fromClass } : {} });
      break;
    case 'open-class': openSheet({ mode: 'class', id }); break;
    case 'toggle': {
      const item = store.get(id);
      if (!item) break;
      const done = !item.done;
      if (done && navigator.vibrate) navigator.vibrate(12);
      await store.patch(id, { done, doneAt: done ? new Date().toISOString() : null });
      if (done) toast(`Done: ${item.title}`, { label: 'Undo', fn: () => store.patch(id, { done: false, doneAt: null }) });
      break;
    }
    case 'habit': await toggleCheck(id, el.dataset.date); break;
    case 'seg':
      state.schoolView = el.dataset.seg;
      localStorage.setItem('schoolView', state.schoolView);
      render();
      break;
    case 'day': state.weekDay = el.dataset.day; render(); break;
    case 'settings': openSheet({ mode: 'settings' }); break;
    case 'sample': await loadSample(); toast('Sample week loaded'); break;
  }
});

main.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'quick') return;
  e.preventDefault();
  const input = e.target.elements.q;
  const { title, due, priority } = parseQuick(input.value);
  if (!title) return;
  input.value = '';
  await store.put('task', { id: uid(), title, due, priority, done: false });
  // Re-render replaced the input; restore focus for rapid entry.
  main.querySelector('input[name="q"]')?.focus();
  toast(due ? `Added · due ${due === todayISO() ? 'today' : new Date(due + 'T00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Added');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSheetOpen()) { closeSheet(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (typing || e.metaKey || e.ctrlKey || e.altKey || isSheetOpen()) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openSheet({ mode: 'add', type: ADD_DEFAULT[state.tab] }); }
  const n = Number(e.key);
  if (n >= 1 && n <= TABS.length) location.hash = TABS[n - 1][0];
});

window.addEventListener('hashchange', route);
store.onChange(() => render());
onSyncState(() => { renderSync(); rerenderSettings(); });

// Re-render when the day rolls over or the app comes back to the foreground,
// so "Today", countdowns and the NOW line are never stale.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
const isTyping = () => main.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
setInterval(() => { if (!document.hidden && !isSheetOpen() && !isTyping()) render(); }, 60_000);

// ---------- boot ----------
(async function boot() {
  initSheet({ toast });
  await store.load();
  route();
  renderSync();
  initSync();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  }
})();
