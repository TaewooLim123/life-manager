// Screen renderers. Each returns an HTML string; app.js wires events by data-action.
import {
  todayISO, iso, addDays, diffDays, weekday, weekStart, parseISO, fmtDate, dueInfo, fmtTime, fmtDur,
  toMin, nowMin, esc, greeting, DAY_SHORT, DAY_LETTER, MONTHS, WEEK_ORDER,
} from './util.js';
import {
  COLORS, colorVars, classes, classById, assignments, tasks, dueUntil, scheduleFor, bookedMinutes,
  habits, isChecked, streak, best, nextMeeting, typeLabel,
} from './model.js';
import { icons } from './icons.js';
import { renderList, openCount } from './lists.js';

const REPEAT_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- shared bits ----------
function head({ eyebrow, title, sub = '', settings = true }) {
  return `<header class="page-head">
    <div>
      <p class="eyebrow">${eyebrow}</p>
      <h1 class="page-title">${title}</h1>
      ${sub ? `<p class="page-sub">${sub}</p>` : ''}
    </div>
    ${settings ? `<div class="head-actions"><button class="icon-btn settings-btn" data-action="settings" aria-label="Settings and sync">${icons.gear}</button></div>` : ''}
  </header>`;
}

function section(title, body, { count, danger = false, link } = {}) {
  return `<section class="section">
    <div class="section-head">
      <h2 class="section-title">${title}</h2>
      ${count ? `<span class="section-count ${danger ? 'danger' : ''}">${count}</span>` : ''}
      <span class="section-rule"></span>
      ${link ? `<button class="section-link" data-action="go" data-tab="${link[1]}">${link[0]} →</button>` : ''}
    </div>
    ${body}
  </section>`;
}

const empty = (title, text, btn = '') => `<div class="empty"><strong>${title}</strong>${text}${btn}</div>`;

function itemRow(x, today, { showClass = true } = {}) {
  const isA = x._kind ? x._kind === 'assignment' : x.classId !== undefined;
  const c = isA ? classById(x.classId) : null;
  const di = dueInfo(x.due, today);
  const meta = [];
  if (isA) {
    if (showClass && c) meta.push(`<span class="tag"><span class="tag-sw"></span>${esc(c.code || c.name)}</span>`);
    meta.push(esc(typeLabel(x.type)));
  } else {
    meta.push(x.repeat ? `↻ ${REPEAT_LABEL[x.repeat]}` : 'To-do');
  }
  if (x.time) meta.push(fmtTime(x.time));
  const style = isA ? colorVars(c?.color || 'ink') : (x.priority === 3 ? '--cc:var(--danger);--cf:#fff' : '--cc:var(--ink);--cf:var(--paper)');
  const kind = isA ? 'assignment' : 'task';
  return `<div class="item ${x.done ? 'done' : ''} ${!isA && x.priority === 3 ? 'prio-high' : ''}" style="${style}">
    <button class="check" data-action="toggle" data-kind="${kind}" data-id="${x.id}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}: ${esc(x.title)}" aria-pressed="${!!x.done}">${icons.check}</button>
    <button class="item-main" data-action="edit" data-kind="${kind}" data-id="${x.id}">
      <div class="item-title">${esc(x.title)}</div>
      <div class="item-meta">${meta.join('<span class="dot"></span>')}</div>
    </button>
    ${x.done ? '' : `<span class="chip ${di.cls}">${di.label}</span>`}
  </div>`;
}

const list = (rows) => `<div class="list">${rows.join('')}</div>`;

// ---------- TODAY ----------
export function renderToday() {
  const t = todayISO();
  const d = parseISO(t);
  const open = assignments();
  const overdue = dueUntil(addDays(t, -1));
  const dueToday = dueUntil(t).filter((x) => x.due === t);
  const weekCount = open.filter((a) => a.due && a.due >= t && a.due <= addDays(t, 6)).length;

  const subParts = [];
  if (dueToday.length) subParts.push(`<b>${dueToday.length} due today</b>`);
  if (overdue.length) subParts.push(`<b style="color:var(--danger)">${overdue.length} overdue</b>`);
  subParts.push(`${weekCount} assignment${weekCount === 1 ? '' : 's'} this week`);
  const doneToday = [...assignments({ includeDone: true }), ...tasks({ includeDone: true })]
    .filter((x) => x.done && x.doneAt && todayISO() === iso(new Date(x.doneAt))).length;
  if (doneToday) subParts.push(`${doneToday} done today ✓`);

  const hasAny = classes().length || open.length || tasks().length || habits().length;

  let html = head({
    eyebrow: `${greeting()} · ${MONTHS[d.getMonth()]} ${d.getDate()}`,
    title: `${DAY_FULL[d.getDay()]}<span class="accent">.</span>`,
    sub: hasAny ? subParts.join(' · ') : '',
  });

  if (!hasAny) {
    return html + empty('A clean slate.',
      'Add your classes first. Assignments, your week and a daily balance build on them.',
      `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-action="add" data-type="class">Add a class</button><button class="btn ghost" data-action="sample">Load a sample week</button></div>`);
  }

  // Hero: the single most urgent assignment.
  const next = open.find((a) => a.due);
  html += next ? hero(next, t) : `<button class="hero calm" data-action="add" data-type="assignment">
      <div class="hero-num">0</div><div class="hero-unit">due</div>
      <h2 class="hero-title">Nothing on the radar. Add an assignment when one lands.</h2></button>`;

  const dueSoon = dueUntil(addDays(t, 1)).filter((x) => !(next && x.id === next.id));
  const left = section('Due now', dueSoon.length ? list(dueSoon.map((x) => itemRow(x, t))) :
    empty('All clear', 'Nothing else due today or tomorrow.'),
  { count: dueSoon.length || '', danger: overdue.length > 0, link: ['All', 'school'] });

  // Big items (exams, projects) two weeks out, so they never sneak up.
  const shown = new Set([next?.id, ...dueSoon.map((x) => x.id)]);
  const big = open.filter((a) => (a.type === 'exam' || a.type === 'project') && a.due && a.due <= addDays(t, 14) && !shown.has(a.id));
  const leftAll = left + (big.length ? section('Exams & projects', list(big.map((x) => itemRow({ ...x, _kind: 'assignment' }, t))), { count: big.length }) : '');
  const right = scheduleSection(t) + habitsStrip(t) + balanceSection(t);
  return html + `<div class="cols two"><div>${leftAll}</div><div>${right}</div></div>`;
}

function hero(a, t) {
  const c = classById(a.classId);
  const n = diffDays(t, a.due);
  let num, unit, tag = '';
  if (n < 0) { num = -n; unit = -n === 1 ? 'day late' : 'days late'; tag = 'Overdue'; }
  else if (n === 0) {
    const left = a.time ? toMin(a.time) - nowMin() : null;
    if (left !== null && left > 0 && left < 24 * 60) { num = left >= 60 ? Math.floor(left / 60) : left; unit = left >= 60 ? 'hours left' : 'min left'; }
    else { num = '0'; unit = 'days · due today'; }
    tag = 'Today';
  } else { num = n; unit = n === 1 ? 'day left' : 'days left'; }
  return `<button class="hero" style="${colorVars(c?.color || 'ink')}" data-action="edit" data-kind="assignment" data-id="${a.id}">
    ${tag ? `<span class="hero-tag">${tag}</span>` : ''}
    <div class="hero-num tnum">${num}</div>
    <div class="hero-unit">${unit}</div>
    <h2 class="hero-title">${esc(a.title)}</h2>
    <div class="hero-meta"><span>${esc(c ? (c.code || c.name) : 'No class')}</span><span>${esc(typeLabel(a.type))}</span><span>${fmtDate(a.due, { long: true })}${a.time ? ' · ' + fmtTime(a.time) : ''}</span></div>
  </button>`;
}

function scheduleSection(t) {
  const evs = scheduleFor(t);
  if (!evs.length) return section('Schedule', empty('Open day', 'No classes or blocks today.'), { link: ['Week', 'week'] });
  const now = nowMin();
  let placedNow = false;
  const rows = [];
  for (const e of evs) {
    const s = toMin(e.start), en = toMin(e.end);
    if (!placedNow && now < s) { rows.push(`<div class="now-line"><span>NOW</span><span></span></div>`); placedNow = true; }
    const state = en <= now ? 'past' : (s <= now ? 'now' : '');
    if (state === 'now') placedNow = true;
    rows.push(`<div class="slot ${state}">
      <div class="slot-time">${fmtTime(e.start)}<small>${fmtTime(e.end)}</small></div>
      <button class="slot-card ${e.soft ? 'soft' : ''}" style="${colorVars(e.color)}" data-action="${e.kind === 'class' ? 'open-class' : 'edit'}" data-kind="${e.kind}" data-id="${e.id}">
        <div class="slot-title">${esc(e.title)}</div>
        <div class="slot-meta">${esc(e.sub)} · ${fmtDur(en - s)}</div>
      </button></div>`);
  }
  if (!placedNow) rows.push(`<div class="now-line"><span>NOW</span><span></span></div>`);
  return section('Schedule', `<div class="timeline">${rows.join('')}</div>`, { link: ['Week', 'week'] });
}

function habitsStrip(t) {
  const hs = habits();
  if (!hs.length) return '';
  const done = hs.filter((h) => isChecked(h.id, t)).length;
  const pills = hs.map((h) => {
    const on = isChecked(h.id, t);
    const st = streak(h.id, t);
    return `<button class="habit-pill ${on ? 'on' : ''}" style="${colorVars(h.color)}" data-action="habit" data-id="${h.id}" data-date="${t}" aria-pressed="${on}">
      <span class="check ${on ? 'on' : ''}">${icons.check}</span>${esc(h.name)}${st ? `<span class="streak">${st}d</span>` : ''}</button>`;
  }).join('');
  return section('Habits', `<div class="habit-strip">${pills}</div>`, { count: `${done}/${hs.length}`, link: ['Streaks', 'habits'] });
}

const BAL = [
  ['class', 'Class', 'var(--ink-2)'], ['study', 'Study', COLORS.cobalt.bg], ['work', 'Work', COLORS.orange.bg],
  ['health', 'Health', COLORS.mint.bg], ['social', 'Social', COLORS.pink.bg], ['other', 'Other', COLORS.violet.bg],
];
const AWAKE = 16 * 60;

function balanceSection(t) {
  const by = bookedMinutes(t);
  const booked = Object.values(by).reduce((a, b) => a + b, 0);
  if (!booked) return '';
  const free = Math.max(0, AWAKE - booked);
  const bar = BAL.filter(([k]) => by[k]).map(([k, , c]) => `<span style="width:${(by[k] / AWAKE) * 100}%;background:${c}" title="${k}"></span>`).join('');
  const legend = BAL.filter(([k]) => by[k]).map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} ${fmtDur(by[k])}</span>`).join('')
    + `<span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>Free ${fmtDur(free)}</span>`;
  const next = assignments().find((a) => a.due && a.due >= t);
  // Time still open today: from now until 11pm, minus what's still booked.
  const now = nowMin();
  const leftBooked = scheduleFor(t).reduce((sum, e) => sum + Math.max(0, toMin(e.end) - Math.max(now, toMin(e.start))), 0);
  const openLeft = Math.max(0, 23 * 60 - Math.max(now, 7 * 60) - leftBooked);
  const dueTomorrow = dueUntil(addDays(t, 1)).filter((x) => x.due === addDays(t, 1)).length;
  let note;
  if (now >= 21 * 60) note = dueTomorrow ? `Winding down. ${dueTomorrow} thing${dueTomorrow === 1 ? '' : 's'} due tomorrow, so check they’re handled.` : 'Winding down. Nothing due tomorrow. Sleep well.';
  else if (booked >= 10 * 60) note = `Heavy day: ${fmtDur(booked)} booked. Protect a real break.`;
  else if (!by.health && booked >= 6 * 60) note = 'Full day and no movement planned. Even a 20-minute walk counts.';
  else if (next && openLeft >= 90) note = `${fmtDur(openLeft)} still open today. Good window to get ahead on “${esc(next.title)}”.`;
  else note = '';
  return section('Balance', `<div class="balance"><div class="balance-bar" role="img" aria-label="${fmtDur(booked)} booked of 16 waking hours">${bar}</div><div class="balance-legend">${legend}</div>${note ? `<p class="balance-note">${note}</p>` : ''}</div>`);
}

// ---------- SCHOOL ----------
export function renderSchool(state) {
  const t = todayISO();
  const view = state.schoolView || 'due';
  const open = assignments();
  let html = head({
    eyebrow: `${classes().length} classes · ${open.length} open`,
    title: `School<span class="accent">.</span>`,
  });
  html += `<div class="seg" role="group" aria-label="View">
    <button data-action="seg" data-key="schoolView" data-seg="due" aria-pressed="${view === 'due'}">Due</button>
    <button data-action="seg" data-key="schoolView" data-seg="classes" aria-pressed="${view === 'classes'}">Classes</button></div>`;

  if (view === 'classes') return html + classGrid(t);

  if (!classes().length) {
    return html + empty('No classes yet', 'Add a class, then log assignments under it.',
      `<div><button class="btn primary" data-action="add" data-type="class">Add a class</button></div>`);
  }
  if (!open.length) {
    html += empty('Nothing due', 'Every assignment is done. Nice.', `<div><button class="btn primary" data-action="add" data-type="assignment">Add assignment</button></div>`);
  } else {
    html += groupByDay(open.map((a) => ({ ...a, _kind: 'assignment' })), t);
  }
  const done = assignments({ includeDone: true }).filter((a) => a.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 15);
  if (done.length) {
    html += `<details class="done-group"><summary>Recently done (${done.length})</summary>${list(done.map((a) => itemRow({ ...a, _kind: 'assignment' }, t)))}</details>`;
  }
  return html;
}

function groupByDay(items, t) {
  const groups = new Map();
  const later = [], nodate = [], overdue = [];
  const horizon = addDays(t, 6);
  for (const x of items) {
    if (!x.due) nodate.push(x);
    else if (x.due < t) overdue.push(x);
    else if (x.due <= horizon) { if (!groups.has(x.due)) groups.set(x.due, []); groups.get(x.due).push(x); }
    else later.push(x);
  }
  let html = '';
  if (overdue.length) html += dayGroup('Overdue', `${overdue.length}`, overdue, t, 'overdue');
  for (const [date, xs] of [...groups.entries()].sort()) {
    const n = diffDays(t, date);
    const label = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : DAY_FULL[weekday(date)];
    html += dayGroup(label, fmtDate(date), xs, t);
  }
  if (later.length) html += dayGroup('Later', '', later, t);
  if (nodate.length) html += dayGroup('No date', '', nodate, t);
  return html;
}
const dayGroup = (label, small, xs, t, cls = '') =>
  `<div class="day-group"><h3 class="day-label ${cls}">${label}<small>${small}</small></h3>${list(xs.map((x) => itemRow(x, t)))}</div>`;

function classGrid(t) {
  const cs = classes();
  const cards = cs.map((c) => {
    const nm = nextMeeting(c);
    const openN = assignments({ classId: c.id }).length;
    const when = nm ? `${nm.offset === 0 ? 'Today' : nm.offset === 1 ? 'Tmrw' : DAY_SHORT[weekday(nm.date)]} ${fmtTime(nm.start)}` : 'No meetings';
    return `<button class="class-card" style="${colorVars(c.color)}" data-action="open-class" data-id="${c.id}">
      <div><div class="class-code">${esc(c.code || c.name)}</div>${c.code ? `<div class="class-name">${esc(c.name)}</div>` : ''}</div>
      <div class="class-foot"><span>${when}</span><span class="class-due tnum">${openN}<small>open</small></span></div>
    </button>`;
  }).join('');
  return `<div class="class-grid">${cards}<button class="class-card add" data-action="add" data-type="class">+ Add class</button></div>`;
}

export function classDetail(c) {
  const t = todayISO();
  const open = assignments({ classId: c.id }).map((a) => ({ ...a, _kind: 'assignment' }));
  const done = assignments({ classId: c.id, includeDone: true }).filter((a) => a.done).map((a) => ({ ...a, _kind: 'assignment' }));
  const meets = (c.meetings || []).map((m) => {
    const days = WEEK_ORDER.filter((d) => (m.days || []).includes(d)).map((d) => DAY_SHORT[d]).join(' ');
    return `<div class="item-meta" style="font-size:14px;color:inherit;opacity:.9"><b>${days || '—'}</b> ${fmtTime(m.start)}–${fmtTime(m.end)}${m.room || c.room ? ' · ' + esc(m.room || c.room) : ''}</div>`;
  }).join('');
  return `
    <div class="class-card" style="${colorVars(c.color)};min-height:0;margin-bottom:18px;cursor:default">
      <div><div class="class-code" style="font-size:34px">${esc(c.code || c.name)}</div>${c.code ? `<div class="class-name">${esc(c.name)}</div>` : ''}</div>
      <div>${meets || '<div class="item-meta" style="color:inherit">No meeting times</div>'}${c.instructor ? `<div class="item-meta" style="color:inherit;opacity:.85">${esc(c.instructor)}</div>` : ''}</div>
    </div>
    ${section('Open', open.length ? list(open.map((x) => itemRow(x, t, { showClass: false }))) : empty('Nothing open', 'Add the next assignment as soon as it’s posted.'), { count: open.length || '' })}
    ${done.length ? `<details class="done-group"><summary>Done (${done.length})</summary>${list(done.map((x) => itemRow(x, t, { showClass: false })))}</details>` : ''}
    <div class="form-actions" style="margin-top:12px">
      <button class="btn primary" data-action="add" data-type="assignment" data-class="${c.id}">Add assignment</button>
      <button class="btn ghost" data-action="edit" data-kind="class" data-id="${c.id}">Edit class</button>
    </div>`;
}

// ---------- LISTS (to-do, groceries, shopping) ----------
export function renderLists(state) {
  const view = state.listView || 'todo';
  const open = tasks();
  const counts = { todo: open.length, grocery: openCount('grocery'), shopping: openCount('shopping') };
  let html = head({ eyebrow: view === 'todo' ? `${open.length} to-dos open` : `${counts[view]} to buy`, title: `Lists<span class="accent">.</span>` });
  html += `<div class="seg" role="group" aria-label="List">${[['todo', 'To-do'], ['grocery', 'Groceries'], ['shopping', 'Shopping']].map(([k, l]) =>
    `<button data-action="seg" data-key="listView" data-seg="${k}" aria-pressed="${view === k}">${l}${counts[k] ? ` <span class="seg-n">${counts[k]}</span>` : ''}</button>`).join('')}</div>`;
  return `<div class="narrow">${html + (view === 'todo' ? todoBody(open) : renderList(view))}</div>`;
}

function todoBody(open) {
  const t = todayISO();
  const overdue = open.filter((x) => x.due && x.due < t);
  const today = open.filter((x) => x.due === t);
  const upcoming = open.filter((x) => x.due && x.due > t);
  const someday = open.filter((x) => !x.due);
  let html = `<form class="quick-add" data-form="quick">
      <input class="input" name="q" type="text" placeholder="Add a to-do…" autocomplete="off" enterkeyhint="done" aria-label="New to-do">
      <button class="btn primary" type="submit">Add</button></form>
    <p class="hint">Try <code>call dentist fri</code>, <code>pay rent tomorrow !</code>, <code>laundry every week</code></p>`;
  if (!open.length) html += empty('Inbox zero', 'Capture anything that isn’t a class assignment here.');
  const sec = (title, xs, opts) => xs.length ? section(title, list(xs.map((x) => itemRow({ ...x, _kind: 'task' }, t))), { count: xs.length, ...opts }) : '';
  html += sec('Overdue', overdue, { danger: true }) + sec('Today', today) + sec('Upcoming', upcoming) + sec('Someday', someday);
  const done = tasks({ includeDone: true }).filter((x) => x.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 15);
  if (done.length) html += `<details class="done-group"><summary>Recently done (${done.length})</summary>${list(done.map((x) => itemRow({ ...x, _kind: 'task' }, t)))}</details>`;
  return html;
}

// ---------- HABITS ----------
export function renderHabits() {
  const t = todayISO();
  const hs = habits();
  const done = hs.filter((h) => isChecked(h.id, t)).length;
  let html = head({
    eyebrow: hs.length ? `${done} of ${hs.length} done today` : 'Small things, daily',
    title: `Habits<span class="accent">.</span>`,
  });
  if (!hs.length) {
    return html + empty('No habits yet', 'Pick one or two you actually want: sleep, study time, movement.',
      `<div><button class="btn primary" data-action="add" data-type="habit">Add a habit</button></div>`);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const rows = hs.map((h) => {
    const on = isChecked(h.id, t);
    const st = streak(h.id, t);
    const b = best(h.id);
    const dots = days.map((d) => `<button class="wd ${isChecked(h.id, d) ? 'on' : ''} ${d === t ? 'today' : ''}" data-action="habit" data-id="${h.id}" data-date="${d}" aria-label="${fmtDate(d, { long: true })}" aria-pressed="${isChecked(h.id, d)}">${DAY_LETTER[weekday(d)]}<b></b></button>`).join('');
    return `<div class="habit-row" style="${colorVars(h.color)}">
      <button class="check ${on ? 'on' : ''}" data-action="habit" data-id="${h.id}" data-date="${t}" aria-pressed="${on}" aria-label="Check ${esc(h.name)} for today">${icons.check}</button>
      <div style="min-width:0"><button class="habit-name" data-action="edit" data-kind="habit" data-id="${h.id}">${esc(h.name)}</button><div class="week-dots">${dots}</div></div>
      <div class="streak-big ${st >= 3 ? 'hot' : ''}"><b class="tnum">${st}</b><span>${st === 1 ? 'day' : 'days'}</span>${b > st ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">best ${b}</div>` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="narrow">${html}<div class="list">${rows}</div></div>`;
}

// ---------- WEEK ----------
/** Side-by-side lanes for overlapping events (events arrive sorted by start). */
function layoutLanes(evs) {
  const out = [];
  let cluster = [], laneEnds = [], clusterEnd = -1;
  const flush = () => { for (const e of cluster) e.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const ev of evs) {
    const s = toMin(ev.start), en = toMin(ev.end);
    if (s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(en); } else laneEnds[lane] = en;
    const e = { ...ev, lane };
    cluster.push(e); out.push(e);
    clusterEnd = Math.max(s >= clusterEnd ? en : clusterEnd, en);
  }
  flush();
  return out;
}

export function renderWeek(state) {
  const t = todayISO();
  const mon = weekStart(t);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const sel = state.weekDay && dates.includes(state.weekDay) ? state.weekDay : t;
  const evsBy = Object.fromEntries(dates.map((d) => [d, scheduleFor(d)]));

  let minH = 8, maxH = 21;
  for (const d of dates) for (const e of evsBy[d]) {
    minH = Math.min(minH, Math.floor(toMin(e.start) / 60));
    maxH = Math.max(maxH, Math.ceil(toMin(e.end) / 60));
  }
  const hours = maxH - minH;
  const totalBooked = dates.reduce((sum, d) => sum + Object.values(bookedMinutes(d)).reduce((a, b) => a + b, 0), 0);

  let html = head({
    eyebrow: `Week of ${fmtDate(mon)}`,
    title: `Week<span class="accent">.</span>`,
    sub: totalBooked ? `<b>${fmtDur(totalBooked)}</b> booked this week` : '',
  });

  if (!classes().length && !Object.values(evsBy).some((x) => x.length)) {
    return html + empty('Nothing scheduled', 'Classes with meeting times show up here automatically. Add study or gym blocks to plan a balanced week.',
      `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-action="add" data-type="class">Add a class</button><button class="btn ghost" data-action="add" data-type="block">Add a block</button></div>`);
  }

  html += `<div class="day-strip" role="group" aria-label="Day">${dates.map((d) => {
    const booked = Object.values(bookedMinutes(d)).reduce((a, b) => a + b, 0);
    return `<button class="day-btn ${d === t ? 'is-today' : ''}" data-action="day" data-day="${d}" aria-pressed="${d === sel}">${DAY_SHORT[weekday(d)].toUpperCase()}<b>${parseISO(d).getDate()}</b><span class="load"><i style="width:${Math.min(100, (booked / (10 * 60)) * 100)}%"></i></span></button>`;
  }).join('')}</div>`;

  const hourLabels = Array.from({ length: hours + 1 }, (_, i) => `<span>${fmtTime(`${String(minH + i).padStart(2, '0')}:00`)}</span>`).join('');
  const now = nowMin();
  const cols = dates.map((d) => {
    const blocksHtml = layoutLanes(evsBy[d]).map((e) => {
      const top = (toMin(e.start) - minH * 60) / 60;
      const h = Math.max(0.42, (toMin(e.end) - toMin(e.start)) / 60);
      const pos = e.lanes > 1 ? `left:calc(${(e.lane / e.lanes) * 100}% + 3px);right:auto;width:calc(${100 / e.lanes}% - 6px);` : '';
      return `<button class="wblock ${e.soft ? 'soft' : ''}" style="${colorVars(e.color)};${pos}top:calc(var(--hour) * ${top.toFixed(3)});height:calc(var(--hour) * ${h.toFixed(3)} - 3px)" data-action="${e.kind === 'class' ? 'open-class' : 'edit'}" data-kind="${e.kind}" data-id="${e.id}">
        <b>${esc(e.title)}</b>${fmtTime(e.start)}–${fmtTime(e.end)}${h >= 1.2 && e.sub ? `<br>${esc(e.sub)}` : ''}</button>`;
    }).join('');
    const nowLine = d === t && now >= minH * 60 && now <= maxH * 60 ? `<div class="wnow" style="top:calc(var(--hour) * ${((now - minH * 60) / 60).toFixed(3)})"></div>` : '';
    return `<div class="wcol ${d === sel ? 'sel' : ''} ${d === t ? 'is-today' : ''}" style="height:calc(var(--hour) * ${hours})">
      <div class="wcol-head">${DAY_SHORT[weekday(d)].toUpperCase()}<b>${parseISO(d).getDate()}</b></div>${blocksHtml}${nowLine}</div>`;
  }).join('');

  html += `<div class="wgrid"><div class="wgrid-hours">${hourLabels}</div><div class="wgrid-days">${cols}</div></div>`;
  html += `<div style="margin-top:18px"><button class="btn ghost small" data-action="add" data-type="block">+ Add study / gym / work block</button></div>`;
  return html;
}

