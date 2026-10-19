// Date + formatting helpers. All dates are LOCAL "YYYY-MM-DD" strings
// (never toISOString(), which shifts to UTC and breaks evening deadlines).

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Display order for weeks: Monday first.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const pad = (n) => String(n).padStart(2, '0');

export function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayISO() { return iso(new Date()); }
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
/** Same day next month(s), clamped (Jan 31 + 1 month -> Feb 28/29). */
export function addMonths(s, n) {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
}
/** Next due date for a repeating to-do: steps from its due date until it lands after today. */
export function nextRepeat(due, repeat, today = todayISO()) {
  const step = (x) => repeat === 'daily' ? addDays(x, 1) : repeat === 'weekly' ? addDays(x, 7) : addMonths(x, 1);
  let next = step(due || today);
  while (next <= today) next = step(next);
  return next;
}
/** Whole days from a to b (b - a), DST-safe. */
export function diffDays(a, b) {
  const da = parseISO(a), db = parseISO(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) -
    Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}
export function weekday(s) { return parseISO(s).getDay(); }
/** Monday of the week containing s. */
export function weekStart(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

export function fmtDate(s, { long = false } = {}) {
  const d = parseISO(s);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return long ? `${DAY_SHORT[d.getDay()]}, ${base}` : base;
}

/** Relative due label + urgency class. */
export function dueInfo(due, today = todayISO()) {
  if (!due) return { label: 'No date', cls: '', days: Infinity };
  const n = diffDays(today, due);
  if (n < 0) return { label: n === -1 ? 'Yesterday' : `${-n}d late`, cls: 'overdue', days: n };
  if (n === 0) return { label: 'Today', cls: 'today', days: 0 };
  if (n === 1) return { label: 'Tomorrow', cls: 'soon', days: 1 };
  if (n < 7) return { label: DAY_SHORT[weekday(due)], cls: n <= 3 ? 'soon' : '', days: n };
  return { label: fmtDate(due), cls: '', days: n };
}

export function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hh = h % 12 || 12;
  return m ? `${hh}:${pad(m)}${suffix}` : `${hh}${suffix}`;
}
export function fmtDur(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Parse natural shorthand at the end of a quick-add line:
 *   "email prof tomorrow !"  -> { title: 'email prof', due: <tomorrow>, priority: 3 }
 * Supports: today, tonight, tomorrow/tmr, mon..sun, "next week", "!" for high priority,
 * and repeats: daily / weekly / monthly / "every week" (repeating items default to due today).
 */
export function parseQuick(text, today = todayISO()) {
  let t = ` ${text.trim()} `;
  let priority = 2, due = null, repeat = null;
  const rep = t.match(/\s(?:every\s(day|week|month)|(daily|weekly|monthly))\s/i);
  if (rep) {
    const w = (rep[1] || rep[2]).toLowerCase();
    repeat = { day: 'daily', week: 'weekly', month: 'monthly' }[w] || w;
    t = t.replace(rep[0], ' ');
  }
  if (/\s!+\s/.test(t) || /!\s*$/.test(t)) { priority = 3; t = t.replace(/!+/g, ' '); }
  const rules = [
    [/\s(today|tonight|tdy)\s/i, () => today],
    [/\s(tomorrow|tmr|tmrw)\s/i, () => addDays(today, 1)],
    [/\snext week\s/i, () => addDays(weekStart(today), 7)],
    [/\s(?:on\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day)?\s/i, (m) => {
      const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3).toLowerCase());
      let n = (idx - weekday(today) + 7) % 7;
      if (n === 0) n = 7;
      return addDays(today, n);
    }],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (m) { due = fn(m); t = t.replace(re, ' '); break; }
  }
  if (repeat && !due) due = today;
  return { title: t.replace(/\s+/g, ' ').trim(), due, priority, repeat };
}
