// Bottom sheet (phone) / modal (desktop): add + edit forms, class detail, settings.
import { store } from './store.js';
import { COLORS, colorVars, classes, ASSIGN_TYPES, BLOCK_CATS, loadSample } from './model.js';
import { classDetail } from './views.js';
import { todayISO, addDays, uid, esc, DAY_LETTER, DAY_SHORT, WEEK_ORDER, toMin } from './util.js';
import { icons } from './icons.js';
import { syncState, signIn, signUp, signOut, syncNow } from './sync.js';

const sheet = document.getElementById('sheet');
const scrim = document.getElementById('scrim');
let lastFocus = null;
let ctx = null; // { mode: 'add'|'edit'|'class'|'settings', type, id, preset }
let toastFn = () => {};

export function initSheet({ toast }) {
  toastFn = toast;
  scrim.addEventListener('click', closeSheet);
  sheet.addEventListener('click', onClick);
  sheet.addEventListener('submit', onSubmit);
  sheet.addEventListener('change', onChange);
  store.onChange(() => { if (ctx && ctx.mode === 'class' && !sheet.hidden) render(); });
}

export const isSheetOpen = () => !sheet.hidden;

export function openSheet(next) {
  ctx = next;
  lastFocus = document.activeElement;
  render();
  sheet.hidden = false;
  scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  const first = sheet.querySelector('.title-input, input[type="email"]');
  // Skip auto-focus on touch devices so the keyboard doesn't cover the form on open.
  if (first && matchMedia('(hover: hover)').matches) first.focus();
  else sheet.querySelector('.sheet-title')?.focus();
}

export function closeSheet() {
  sheet.hidden = true;
  scrim.hidden = true;
  document.body.style.overflow = '';
  ctx = null;
  lastFocus?.focus?.();
}

export function rerenderSettings() {
  if (ctx?.mode === 'settings' && !sheet.hidden) render();
}

function render() {
  const { mode } = ctx;
  let title, body, tabs = '';
  if (mode === 'class') {
    const c = store.get(ctx.id);
    if (!c) return closeSheet();
    title = 'Class';
    body = classDetail(c);
  } else if (mode === 'settings') {
    title = 'Settings';
    body = settingsBody();
  } else {
    const item = mode === 'edit' ? store.get(ctx.id) : null;
    if (mode === 'edit' && !item) return closeSheet();
    title = mode === 'edit' ? `Edit ${LABEL[ctx.type].toLowerCase()}` : 'New';
    if (mode === 'add') {
      tabs = `<div class="type-tabs" role="group" aria-label="Type">${Object.entries(LABEL).map(([k, l]) =>
        `<button type="button" data-sheet="type" data-type="${k}" aria-pressed="${ctx.type === k}">${l}</button>`).join('')}</div>`;
    }
    body = FORMS[ctx.type](item || {}, ctx.preset || {});
  }
  sheet.innerHTML = `<div class="sheet-grip"></div>
    <div class="sheet-head"><h2 class="sheet-title" id="sheet-title" tabindex="-1">${title}</h2>
    <button class="icon-btn" data-sheet="close" aria-label="Close">${icons.close}</button></div>${tabs}${body}`;
}

// ---------- form building blocks ----------
const LABEL = { assignment: 'Assignment', task: 'Task', class: 'Class', habit: 'Habit', block: 'Block' };

const field = (label, inner) => `<label class="field"><span>${label}</span>${inner}</label>`;
const group = (label, inner) => `<div class="field"><span class="field-label">${label}</span>${inner}</div>`;
const radio = (name, value, label, checked, extra = '') =>
  `<label class="opt" ${extra}><input class="sr-only" type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}>${label}</label>`;
const daysPicker = (name, days = []) => `<div class="opts">${WEEK_ORDER.map((d) =>
  `<label class="opt day" title="${DAY_SHORT[d]}"><input class="sr-only" type="checkbox" name="${name}" value="${d}" ${days.includes(d) ? 'checked' : ''}>${DAY_LETTER[d]}</label>`).join('')}</div>`;
const swatches = (name, current) => `<div class="swatches">${Object.keys(COLORS).filter((k) => k !== 'ink').map((k) =>
  `<label class="swatch" style="${colorVars(k)}" title="${k}"><input class="sr-only" type="radio" name="${name}" value="${k}" ${current === k ? 'checked' : ''}><span class="sr-only">${k}</span></label>`).join('')}</div>`;
const actions = (isEdit) => `<div class="form-actions">
  ${isEdit ? `<button type="button" class="btn danger" data-sheet="delete">Delete</button>` : ''}
  <button type="submit" class="btn primary">${isEdit ? 'Save' : 'Add'}</button></div>`;

function nextFreeColor() {
  const used = new Set(classes().map((c) => c.color));
  return Object.keys(COLORS).find((k) => k !== 'ink' && !used.has(k)) || 'tomato';
}

const FORMS = {
  assignment(a, preset) {
    const cs = classes();
    const classId = a.classId ?? preset.classId ?? cs[0]?.id ?? '';
    const t = todayISO();
    return `<form class="form" data-form="assignment">
      ${field('What', `<input class="title-input" type="text" name="title" required placeholder="Lab 5, Essay draft, Midterm…" value="${esc(a.title || '')}" autocomplete="off" enterkeyhint="done">`)}
      ${cs.length ? group('Class', `<div class="opts">${cs.map((c) => radio('classId', c.id, `<span class="tag-sw" style="${colorVars(c.color)}"></span>${esc(c.code || c.name)}`, c.id === classId)).join('')}</div>`)
        : `<p class="form-note">No classes yet. You can add one from the Class tab above.</p>`}
      ${group('Type', `<div class="opts">${ASSIGN_TYPES.map(([k, l]) => radio('type', k, l, (a.type || 'hw') === k)).join('')}</div>`)}
      <div class="row">
        ${field('Due', `<input type="date" name="due" required value="${a.due || addDays(t, 1)}">`)}
        ${field('Time (optional)', `<input type="time" name="time" value="${a.time || ''}">`)}
      </div>
      <div class="opts">${[['Today', t], ['Tomorrow', addDays(t, 1)], ['In 1 week', addDays(t, 7)]].map(([l, d]) => `<button type="button" class="opt" data-sheet="date" data-date="${d}">${l}</button>`).join('')}</div>
      ${field('Notes (optional)', `<textarea name="notes" rows="2" placeholder="Chapters, rubric link, group members…">${esc(a.notes || '')}</textarea>`)}
      ${actions(!!a.id)}</form>`;
  },

  task(x) {
    const t = todayISO();
    return `<form class="form" data-form="task">
      ${field('What', `<input class="title-input" type="text" name="title" required placeholder="Call the financial aid office" value="${esc(x.title || '')}" autocomplete="off" enterkeyhint="done">`)}
      ${field('Due (optional)', `<input type="date" name="due" value="${x.due || ''}">`)}
      <div class="opts">${[['Today', t], ['Tomorrow', addDays(t, 1)], ['This weekend', addDays(t, (6 - new Date().getDay() + 7) % 7 || 7)], ['No date', '']].map(([l, d]) => `<button type="button" class="opt" data-sheet="date" data-date="${d}">${l}</button>`).join('')}</div>
      ${group('Priority', `<div class="opts">${[[1, 'Low'], [2, 'Normal'], [3, 'High']].map(([v, l]) => radio('priority', v, l, (x.priority || 2) === v)).join('')}</div>`)}
      ${field('Notes (optional)', `<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea>`)}
      ${actions(!!x.id)}</form>`;
  },

  class(c) {
    const meetings = c.meetings?.length ? c.meetings : [{ days: [], start: '', end: '' }];
    return `<form class="form" data-form="class">
      <div class="row">
        ${field('Code', `<input class="title-input" type="text" name="code" placeholder="MATH 1C" value="${esc(c.code || '')}" autocomplete="off">`)}
        ${field('Room', `<input type="text" name="room" placeholder="S35" value="${esc(c.room || '')}" autocomplete="off">`)}
      </div>
      ${field('Name', `<input type="text" name="name" required placeholder="Multivariable Calculus" value="${esc(c.name || '')}" autocomplete="off">`)}
      ${group('Color', swatches('color', c.color || nextFreeColor()))}
      ${group('Meets', `<div class="meetings" style="display:flex;flex-direction:column;gap:8px">${meetings.map(meetRow).join('')}</div>
        <button type="button" class="btn ghost small" data-sheet="add-meet" style="align-self:flex-start">+ Another time (lab, discussion)</button>`)}
      ${field('Instructor (optional)', `<input type="text" name="instructor" value="${esc(c.instructor || '')}" autocomplete="off">`)}
      ${actions(!!c.id)}</form>`;
  },

  habit(h) {
    return `<form class="form" data-form="habit">
      ${field('Habit', `<input class="title-input" type="text" name="name" required placeholder="Sleep by midnight" value="${esc(h.name || '')}" autocomplete="off" enterkeyhint="done">`)}
      ${group('Color', swatches('color', h.color || 'mint'))}
      ${actions(!!h.id)}</form>`;
  },

  block(b) {
    return `<form class="form" data-form="block">
      ${field('Block', `<input class="title-input" type="text" name="title" required placeholder="Library study, Gym, Shift…" value="${esc(b.title || '')}" autocomplete="off">`)}
      ${group('Kind', `<div class="opts">${BLOCK_CATS.map(([k, l, col]) => radio('category', k, `<span class="tag-sw" style="${colorVars(col)}"></span>${l}`, (b.category || 'study') === k)).join('')}</div>`)}
      ${group('Repeats on', daysPicker('days', b.days || []))}
      <div class="row">
        ${field('Start', `<input type="time" name="start" required value="${b.start || ''}">`)}
        ${field('End', `<input type="time" name="end" required value="${b.end || ''}">`)}
      </div>
      ${actions(!!b.id)}</form>`;
  },
};

let meetSeq = 0;
function meetRow(m) {
  const k = 'm' + (meetSeq++);
  return `<div class="meet-row" data-meet="${k}">
    <button type="button" class="meet-del" data-sheet="del-meet" aria-label="Remove time">Remove</button>
    ${daysPicker(k + '_days', m.days || [])}
    <div class="row">
      <input type="time" name="${k}_start" value="${m.start || ''}" aria-label="Start">
      <input type="time" name="${k}_end" value="${m.end || ''}" aria-label="End">
    </div>
    <input type="text" name="${k}_room" value="${esc(m.room || '')}" placeholder="Different room? (optional)" autocomplete="off">
  </div>`;
}

// ---------- settings ----------
function settingsBody() {
  const theme = localStorage.getItem('theme') || 'system';
  let sync;
  if (!syncState.configured) {
    sync = `<p>Sync is <b>off</b>. Everything is saved on this device. To sync your iPhone and Mac, add your Supabase URL and key to <code>js/config.js</code> (steps in README).</p>`;
  } else if (!syncState.signedIn) {
    sync = `<p>Sign in with the same email and password on your iPhone and your Mac. First time? Use <b>Create account</b> once.</p>
      <form class="form" data-form="signin" style="gap:10px">
        <input type="email" name="email" required placeholder="you@example.com" autocomplete="username" autocapitalize="off" spellcheck="false">
        <input type="password" name="password" required minlength="8" placeholder="Password (8+ characters)" autocomplete="current-password">
        <div class="set-buttons"><button class="btn primary" type="submit" name="step" value="signin">Sign in</button><button class="btn ghost" type="submit" name="step" value="signup">Create account</button></div>
      </form>`;
  } else {
    const last = syncState.lastSync ? syncState.lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
    sync = `<p>Signed in as <b>${esc(syncState.email)}</b>. Last synced ${last}${syncState.status === 'error' ? ` · <span style="color:var(--danger)">${esc(syncState.error)}</span>` : ''}.</p>
      <div class="set-buttons"><button class="btn small" data-sheet="sync-now">Sync now</button><button class="btn small ghost" data-sheet="sign-out">Sign out</button></div>`;
  }
  return `<div class="form">
    <div class="set-group"><h3>Sync</h3>${sync}</div>
    <div class="set-group"><h3>Appearance</h3>
      <div class="opts">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) =>
        `<label class="opt"><input class="sr-only" type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
    <div class="set-group"><h3>Install</h3>
      <p><b>iPhone:</b> open in Safari → Share → <i>Add to Home Screen</i>.<br><b>Mac:</b> Safari → File → <i>Add to Dock</i>, or Chrome → Install.</p></div>
    <div class="set-group"><h3>Data</h3>
      <p>Backups are plain JSON files you can keep in iCloud Drive.</p>
      <div class="set-buttons">
        <button class="btn small" data-sheet="export">Export backup</button>
        <label class="btn small" style="cursor:pointer">Import backup<input type="file" accept="application/json,.json" data-sheet="import" class="sr-only"></label>
        <button class="btn small ghost" data-sheet="sample">Load sample week</button>
        <button class="btn small danger" data-sheet="wipe">Reset this device</button>
      </div></div>
  </div>`;
}

// ---------- events ----------
async function onClick(e) {
  const el = e.target.closest('[data-sheet], [data-action]');
  if (!el) return;
  const a = el.dataset.sheet;
  if (!a) return; // [data-action] inside sheet (class detail) is handled by app.js delegation
  if (a === 'close') return closeSheet();
  if (a === 'type') { ctx.type = el.dataset.type; render(); return; }
  if (a === 'date') {
    const input = sheet.querySelector('input[name="due"]');
    if (input) input.value = el.dataset.date;
    return;
  }
  if (a === 'add-meet') { sheet.querySelector('.meetings').insertAdjacentHTML('beforeend', meetRow({})); return; }
  if (a === 'del-meet') { el.closest('.meet-row').remove(); return; }
  if (a === 'delete') return del();
  if (a === 'export') return exportBackup();
  if (a === 'sample') { await loadSample(); closeSheet(); toastFn('Sample week loaded'); return; }
  if (a === 'wipe') {
    if (!confirm(syncState.signedIn ? 'Clear all data on this device? Your synced copy stays in the cloud and downloads again.' : 'Delete ALL data on this device? This cannot be undone. Export a backup first if unsure.')) return;
    await store.wipe(); closeSheet(); toastFn('This device was reset');
    if (syncState.signedIn) syncNow();
    return;
  }
  if (a === 'sync-now') { await syncNow(); render(); toastFn(syncState.status === 'error' ? 'Sync failed' : 'Synced'); return; }
  if (a === 'sign-out') { await signOut(); render(); return; }
}

async function onChange(e) {
  if (e.target.name === 'theme') {
    const v = e.target.value;
    if (v === 'system') { localStorage.removeItem('theme'); delete document.documentElement.dataset.theme; }
    else { localStorage.setItem('theme', v); document.documentElement.dataset.theme = v; }
    document.dispatchEvent(new Event('themechange'));
  }
  if (e.target.dataset.sheet === 'import' && e.target.files[0]) {
    try {
      const n = await store.importJSON(await e.target.files[0].text());
      closeSheet(); toastFn(`Imported ${n} items`);
    } catch (err) { toastFn('Import failed: ' + err.message); }
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const kind = form.dataset.form;
  const fd = new FormData(form);
  const str = (k) => (fd.get(k) || '').toString().trim();

  if (kind === 'signin') {
    const email = str('email');
    const password = (fd.get('password') || '').toString();
    const btns = form.querySelectorAll('button');
    btns.forEach((b) => { b.disabled = true; });
    try {
      if (e.submitter?.value === 'signup') await signUp(email, password);
      else await signIn(email, password);
      toastFn('Signed in · syncing');
    } catch (err) {
      btns.forEach((b) => { b.disabled = false; });
      const msg = err.message || 'Sign-in failed';
      toastFn(/failed to fetch|network/i.test(msg) ? 'Can’t reach Supabase. Check your connection, or the project may be paused.'
        : /invalid login/i.test(msg) ? 'Wrong email or password. New here? Tap Create account.' : msg);
      return;
    }
    render();
    return;
  }

  const isEdit = ctx.mode === 'edit';
  const id = isEdit ? ctx.id : uid();
  const prev = isEdit ? store.get(id) : {};
  let obj;

  if (kind === 'assignment') {
    obj = { ...prev, id, title: str('title'), classId: str('classId') || null, type: str('type') || 'hw', due: str('due'), time: str('time') || null, notes: str('notes'), done: prev.done || false };
  } else if (kind === 'task') {
    obj = { ...prev, id, title: str('title'), due: str('due') || null, priority: Number(str('priority')) || 2, notes: str('notes'), done: prev.done || false };
  } else if (kind === 'habit') {
    obj = { ...prev, id, name: str('name'), color: str('color') || 'mint', order: prev.order ?? Date.now() };
  } else if (kind === 'block') {
    const days = fd.getAll('days').map(Number);
    if (!days.length) return toastFn('Pick at least one day');
    if (toMin(str('end')) <= toMin(str('start'))) return toastFn('End time must be after start');
    obj = { ...prev, id, title: str('title'), category: str('category') || 'other', days, start: str('start'), end: str('end') };
  } else if (kind === 'class') {
    const meetings = [];
    for (const row of form.querySelectorAll('.meet-row')) {
      const k = row.dataset.meet;
      const days = fd.getAll(k + '_days').map(Number);
      const start = str(k + '_start'), end = str(k + '_end');
      if (!days.length && !start && !end) continue;
      if (!days.length || !start || !end) return toastFn('Each meeting time needs days, start and end');
      if (toMin(end) <= toMin(start)) return toastFn('Class end time must be after start');
      meetings.push({ days, start, end, room: str(k + '_room') || undefined });
    }
    obj = { ...prev, id, code: str('code'), name: str('name'), room: str('room'), color: str('color') || 'tomato', instructor: str('instructor'), meetings };
  }

  await store.put(kind, obj);
  const label = LABEL[kind];
  const wasClassCtx = ctx.preset?.returnTo;
  closeSheet();
  toastFn(isEdit ? `${label} saved` : `${label} added`);
  if (wasClassCtx) openSheet({ mode: 'class', id: wasClassCtx });
}

async function del() {
  const { type, id } = ctx;
  const ids = [id];
  if (type === 'class') {
    for (const a of store.list('assignment')) if (a.classId === id) ids.push(a.id);
  }
  for (const x of ids) await store.remove(x);
  closeSheet();
  const extra = ids.length > 1 ? ` + ${ids.length - 1} assignment${ids.length > 2 ? 's' : ''}` : '';
  toastFn(`${LABEL[type]} deleted${extra}`, { label: 'Undo', fn: async () => { for (const x of ids) await store.restore(x); } });
}

function exportBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `life-manager-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
