// App shell: routing, rendering, event delegation, keyboard shortcuts, service worker.
import { store } from './store.js';
import { renderToday, renderSchool, renderLists, renderHabits, renderWeek } from './views.js';
import { addItems, toggleItem, clearChecked, unclear, LISTS } from './lists.js';
import { maybeAutoImport } from './canvas.js';
import { initSheet, openSheet, closeSheet, isSheetOpen, rerenderSettings } from './sheet.js';
import { toggleCheck, loadSample } from './model.js';
import { icons } from './icons.js';
import { initSync, onSyncState, syncState } from './sync.js';
import { parseQuick, uid, todayISO, nextRepeat, fmtDate } from './util.js';

const TABS = [
  ['today', 'Today', renderToday],
  ['school', 'School', renderSchool],
  ['tasks', 'Lists', renderLists],
  ['habits', 'Habits', renderHabits],
  ['week', 'Week', renderWeek],
];
// What the + button creates on each tab.
const ADD_DEFAULT = { today: 'assignment', school: 'assignment', tasks: 'task', habits: 'habit', week: 'block' };

const state = {
  tab: 'today',
  schoolView: localStorage.getItem('schoolView') || 'due',
  listView: localStorage.getItem('listView') || 'todo',
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
      // On a grocery/shopping list, + jumps to the quick-add field instead of a form.
      if (state.tab === 'tasks' && state.listView !== 'todo' && !el.dataset.type && !inSheet) { focusQuickAdd(); break; }
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
      // Repeating to-do: completing it rolls the due date forward instead of finishing it.
      if (done && kind === 'task' && item.repeat) {
        const prevDue = item.due;
        const next = nextRepeat(item.due, item.repeat);
        await store.patch(id, { due: next, lastDoneAt: new Date().toISOString() });
        toast(`Done · next ${fmtDate(next, { long: true })}`, { label: 'Undo', fn: () => store.patch(id, { due: prevDue }) });
        break;
      }
      await store.patch(id, { done, doneAt: done ? new Date().toISOString() : null });
      if (done) toast(`Done: ${item.title}`, { label: 'Undo', fn: () => store.patch(id, { done: false, doneAt: null }) });
      break;
    }
    case 'habit': await toggleCheck(id, el.dataset.date); break;
    case 'seg': {
      const key = el.dataset.key || 'schoolView';
      state[key] = el.dataset.seg;
      localStorage.setItem(key, state[key]);
      render();
      break;
    }
    case 'item-toggle': await toggleItem(id); break;
    case 'item-again': {
      await addItems(el.dataset.list, el.dataset.name);
      toast(`Added ${el.dataset.name}`);
      break;
    }
    case 'clear-checked': {
      const list = el.dataset.list;
      const cleared = await clearChecked(list);
      toast(`Cleared ${cleared.length} from ${LISTS[list]}`, { label: 'Undo', fn: () => unclear(cleared) });
      break;
    }
    case 'day': state.weekDay = el.dataset.day; render(); break;
    case 'settings': openSheet({ mode: 'settings' }); break;
    case 'sample': await loadSample(); toast('Sample week loaded'); break;
  }
});

function focusQuickAdd() {
  const q = main.querySelector('input[name="q"]');
  if (q) { q.scrollIntoView({ block: 'center', behavior: 'smooth' }); q.focus(); }
}

main.addEventListener('submit', async (e) => {
  const form = e.target.dataset.form;
  if (form === 'item') {
    e.preventDefault();
    const input = e.target.elements.q;
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    const { added, dupes } = await addItems(e.target.dataset.list, text);
    main.querySelector('input[name="q"]')?.focus();
    toast(added.length ? `Added ${added.length > 1 ? added.length + ' items' : added[0]}${dupes.length ? ` · ${dupes.join(', ')} already on list` : ''}` : `${dupes.join(', ')} already on the list`);
    return;
  }
  if (form !== 'quick') return;
  e.preventDefault();
  const input = e.target.elements.q;
  const { title, due, priority, repeat } = parseQuick(input.value);
  if (!title) return;
  input.value = '';
  await store.put('task', { id: uid(), title, due, priority, repeat, done: false });
  // Re-render replaced the input; restore focus for rapid entry.
  main.querySelector('input[name="q"]')?.focus();
  toast(due ? `Added · due ${due === todayISO() ? 'today' : new Date(due + 'T00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Added');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSheetOpen()) { closeSheet(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (typing || e.metaKey || e.ctrlKey || e.altKey || isSheetOpen()) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    if (state.tab === 'tasks' && state.listView !== 'todo') focusQuickAdd();
    else openSheet({ mode: 'add', type: ADD_DEFAULT[state.tab] });
  }
  const n = Number(e.key);
  if (n >= 1 && n <= TABS.length) location.hash = TABS[n - 1][0];
});

window.addEventListener('hashchange', route);
store.onChange(() => render());
onSyncState((s) => {
  renderSync();
  rerenderSettings();
  if (s.signedIn && s.status === 'idle') autoCanvas(); // after the first sync, so mappings have arrived
});

// Canvas: quietly re-import at most hourly; only speak up when something changed.
function autoCanvas() {
  maybeAutoImport((r) => {
    if (r.added) toast(`Canvas: ${r.added} new assignment${r.added > 1 ? 's' : ''}`);
    else if (r.unmapped.length) toast(`Canvas: pick a class for ${r.unmapped.length} new course${r.unmapped.length > 1 ? 's' : ''} in Settings`);
  });
}

// Re-render when the day rolls over or the app comes back to the foreground,
// so "Today", countdowns and the NOW line are never stale.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); autoCanvas(); } });
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
