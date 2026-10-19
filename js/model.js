// Domain logic: colors, derived views over the store, sample data.
import { store } from './store.js';
import { todayISO, addDays, diffDays, weekday, toMin, uid } from './util.js';

// Muted, earthy palette (same in light and dark mode); fg chosen for contrast.
// Keys are kept from v1 so synced data keeps its colors; `label` is what you see.
export const COLORS = {
  cobalt: { bg: '#4D6A8A', fg: '#FFFFFF', label: 'Slate' },
  tomato: { bg: '#B4674E', fg: '#FFFFFF', label: 'Clay' },
  mint: { bg: '#6E8B6F', fg: '#FFFFFF', label: 'Sage' },
  citron: { bg: '#C4A055', fg: '#1E1A14', label: 'Ochre' },
  violet: { bg: '#775E8C', fg: '#FFFFFF', label: 'Plum' },
  sky: { bg: '#4F8584', fg: '#FFFFFF', label: 'Teal' },
  pink: { bg: '#B07A84', fg: '#FFFFFF', label: 'Rose' },
  orange: { bg: '#C0905E', fg: '#1E1A14', label: 'Sand' },
  ink: { bg: '#17140F', fg: '#F4EFE6', label: 'Ink' },
};
export const colorVars = (name) => {
  const c = COLORS[name] || COLORS.ink;
  return `--cc:${c.bg};--cf:${c.fg}`;
};

export const ASSIGN_TYPES = [
  ['hw', 'Homework'], ['quiz', 'Quiz'], ['exam', 'Exam'], ['project', 'Project'], ['reading', 'Reading'], ['lab', 'Lab'],
];
export const typeLabel = (t) => (ASSIGN_TYPES.find(([k]) => k === t) || [, 'Homework'])[1];

export const BLOCK_CATS = [
  ['study', 'Study', 'cobalt'], ['health', 'Gym / health', 'mint'], ['work', 'Work', 'orange'],
  ['social', 'Social / free', 'pink'], ['other', 'Other', 'violet'],
];
export const catColor = (c) => (BLOCK_CATS.find(([k]) => k === c) || BLOCK_CATS[4])[2];
export const catLabel = (c) => (BLOCK_CATS.find(([k]) => k === c) || BLOCK_CATS[4])[1];

// ---------- Queries ----------
export const classes = () => store.list('class').sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
export const classById = (id) => store.get(id);
export const habits = () => store.list('habit').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
export const blocks = () => store.list('block');

const byDue = (a, b) =>
  (a.due || '9999').localeCompare(b.due || '9999') ||
  (a.time || '99').localeCompare(b.time || '99') ||
  (b.priority || 2) - (a.priority || 2) ||
  (a.title || '').localeCompare(b.title || '');

export function assignments({ includeDone = false, classId } = {}) {
  return store.list('assignment')
    .filter((a) => (includeDone || !a.done) && (!classId || a.classId === classId))
    .sort(byDue);
}
export function tasks({ includeDone = false } = {}) {
  return store.list('task').filter((t) => includeDone || !t.done).sort(byDue);
}

/** Everything open with a due date on or before `until`, school + tasks merged. */
export function dueUntil(until) {
  const a = assignments().filter((x) => x.due && x.due <= until).map((x) => ({ ...x, _kind: 'assignment' }));
  const t = tasks().filter((x) => x.due && x.due <= until).map((x) => ({ ...x, _kind: 'task' }));
  return [...a, ...t].sort(byDue);
}

/** Classes + time blocks happening on a date, sorted by start. */
export function scheduleFor(date) {
  const wd = weekday(date);
  const out = [];
  for (const c of classes()) {
    for (const m of c.meetings || []) {
      if ((m.days || []).includes(wd) && m.start && m.end) {
        out.push({ id: c.id, kind: 'class', title: c.code || c.name, sub: [c.name !== c.code ? c.name : '', m.room || c.room].filter(Boolean).join(' · '), start: m.start, end: m.end, color: c.color, soft: false, cat: 'class' });
      }
    }
  }
  for (const b of blocks()) {
    if ((b.days || []).includes(wd) && b.start && b.end) {
      out.push({ id: b.id, kind: 'block', title: b.title, sub: catLabel(b.category), start: b.start, end: b.end, color: catColor(b.category), soft: true, cat: b.category });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function bookedMinutes(date) {
  const by = { class: 0, study: 0, health: 0, work: 0, social: 0, other: 0 };
  for (const e of scheduleFor(date)) {
    const m = Math.max(0, toMin(e.end) - toMin(e.start));
    by[e.cat in by ? e.cat : 'other'] += m;
  }
  return by;
}

// ---------- Habits ----------
const checkinId = (habitId, date) => `${habitId}|${date}`;
export function isChecked(habitId, date) { return !!store.get(checkinId(habitId, date)); }
export async function toggleCheck(habitId, date) {
  const id = checkinId(habitId, date);
  if (store.get(id)) await store.remove(id);
  else await store.put('checkin', { id, habitId, date });
}
/** Consecutive days ending today — or yesterday, so a streak isn't "broken" before you've had the chance today. */
export function streak(habitId, today = todayISO()) {
  let d = isChecked(habitId, today) ? today : addDays(today, -1);
  let n = 0;
  while (isChecked(habitId, d)) { n++; d = addDays(d, -1); }
  return n;
}
export function best(habitId) {
  const dates = store.list('checkin').filter((c) => c.habitId === habitId).map((c) => c.date).sort();
  let bestRun = 0, run = 0, prev = null;
  for (const d of dates) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    bestRun = Math.max(bestRun, run);
    prev = d;
  }
  return bestRun;
}

// ---------- Class helpers ----------
export function nextMeeting(c, now = new Date()) {
  const today = todayISO();
  const nowM = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    const wd = weekday(date);
    const ms = (c.meetings || []).filter((m) => (m.days || []).includes(wd) && m.start)
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const m of ms) {
      if (i > 0 || toMin(m.end || m.start) > nowM) return { date, ...m, offset: i };
    }
  }
  return null;
}

// ---------- Sample data (relative to this week so it always looks current) ----------
export async function loadSample() {
  const t = todayISO();
  const cls = [
    { id: uid(), name: 'Multivariable Calculus', code: 'MATH 1C', color: 'cobalt', room: 'S35', meetings: [{ days: [1, 3], start: '09:30', end: '11:20' }] },
    { id: uid(), name: 'Data Abstraction & Structures', code: 'CIS 22C', color: 'tomato', room: 'ATC 203', meetings: [{ days: [2, 4], start: '13:30', end: '15:20' }, { days: [5], start: '10:00', end: '11:50', room: 'Online' }] },
    { id: uid(), name: 'Critical Reading & Writing', code: 'EWRT 2', color: 'citron', room: 'L23', meetings: [{ days: [1, 3], start: '12:30', end: '14:20' }] },
    { id: uid(), name: 'Physics: Mechanics', code: 'PHYS 4A', color: 'violet', room: 'S16', meetings: [{ days: [2, 4], start: '08:30', end: '10:20' }, { days: [3], start: '15:30', end: '18:20', room: 'S18 lab' }] },
  ];
  const [math, cis, ewrt, phys] = cls.map((c) => c.id);
  const items = [
    ...cls.map((c) => ['class', c]),
    ['assignment', { id: uid(), classId: cis, title: 'Lab 4: AVL tree insert/delete', type: 'lab', due: addDays(t, 1), time: '23:59', done: false }],
    ['assignment', { id: uid(), classId: math, title: 'WebAssign 14.3 Partial derivatives', type: 'hw', due: t, time: '23:59', done: false }],
    ['assignment', { id: uid(), classId: ewrt, title: 'Rhetorical analysis draft', type: 'project', due: addDays(t, 3), done: false }],
    ['assignment', { id: uid(), classId: phys, title: 'Midterm 2', type: 'exam', due: addDays(t, 6), time: '08:30', done: false }],
    ['assignment', { id: uid(), classId: math, title: 'Quiz 5', type: 'quiz', due: addDays(t, 4), done: false }],
    ['assignment', { id: uid(), classId: phys, title: 'Ch. 9 problem set', type: 'hw', due: addDays(t, -1), done: false }],
    ['assignment', { id: uid(), classId: ewrt, title: 'Read: Orwell, "Politics and the English Language"', type: 'reading', due: addDays(t, -2), done: true }],
    ['task', { id: uid(), title: 'Email counselor about transfer plan', due: addDays(t, 1), priority: 3, done: false }],
    ['task', { id: uid(), title: 'Renew parking permit', due: addDays(t, 2), priority: 2, done: false }],
    ['task', { id: uid(), title: 'Laundry', due: t, priority: 2, repeat: 'weekly', done: false }],
    ['task', { id: uid(), title: 'Pay phone bill', due: addDays(t, 5), priority: 2, repeat: 'monthly', done: false }],
    ...[['Milk', '1 gal', 'dairy'], ['Eggs', '12', 'dairy'], ['Bananas', '', 'produce'], ['Spinach', '', 'produce'], ['Chicken thighs', '2 lb', 'meat'], ['Rice', '', 'pantry'], ['Greek yogurt', '', 'dairy', true]]
      .map(([name, qty, aisle, checked]) => ['item', { id: uid(), list: 'grocery', name, qty, aisle, checked: !!checked, archived: false, count: 1 }]),
    ...[['Oat milk', 'dairy', 6], ['Coffee beans', 'drinks', 4], ['Avocados', 'produce', 3], ['Tortillas', 'bakery', 2]]
      .map(([name, aisle, count]) => ['item', { id: uid(), list: 'grocery', name, qty: '', aisle, checked: false, archived: true, count }]),
    ['item', { id: uid(), list: 'shopping', name: 'USB-C cable', qty: '', checked: false, archived: false, count: 1 }],
    ['item', { id: uid(), list: 'shopping', name: 'Blue books', qty: '3', note: 'Bookstore, for PHYS midterm', checked: false, archived: false, count: 1 }],
    ['task', { id: uid(), title: 'Update résumé for internship apps', due: null, priority: 2, done: false }],
    ['block', { id: uid(), title: 'Library study', category: 'study', days: [1, 3], start: '15:00', end: '17:00' }],
    ['block', { id: uid(), title: 'Gym', category: 'health', days: [2, 4, 6], start: '17:30', end: '18:45' }],
    ['block', { id: uid(), title: 'Campus job', category: 'work', days: [5], start: '13:00', end: '17:00' }],
    ['block', { id: uid(), title: 'Weekly review + plan', category: 'other', days: [0], start: '19:00', end: '19:30' }],
  ];
  const hs = [
    { id: uid(), name: 'Sleep by midnight', color: 'violet', order: 0 },
    { id: uid(), name: 'Study 2 hours', color: 'cobalt', order: 1 },
    { id: uid(), name: 'Move 30 min', color: 'mint', order: 2 },
  ];
  for (const h of hs) items.push(['habit', h]);
  // A believable history: streaks of different lengths.
  const hist = [[0, 9, []], [1, 4, [6]], [2, 2, [3]]];
  for (const [hi, len, gaps] of hist) {
    for (let i = 1; i <= len + gaps.length; i++) {
      if (gaps.includes(i)) continue;
      const date = addDays(t, -i);
      items.push(['checkin', { id: `${hs[hi].id}|${date}`, habitId: hs[hi].id, date }]);
    }
  }
  await store.putMany(items);
}
