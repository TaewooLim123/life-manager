// Canvas calendar import.
// Canvas → Calendar → "Calendar Feed" gives a private .ics link. We fetch it through the
// `canvas-feed` Supabase Edge Function (Canvas sends no CORS headers), parse the events,
// and upsert assignments with stable ids so re-imports update instead of duplicating.
import { store } from './store.js';
import { iso, uid } from './util.js';
import { classes, COLORS } from './model.js';
import { getClient, syncState } from './sync.js';

const SETTINGS_ID = 'setting-canvas';
const AUTO_EVERY_MIN = 60;
let lastFeed = null; // raw ICS text from the most recent fetch (memory only)
let running = null;

export const canvasSettings = () => store.get(SETTINGS_ID);
async function saveSettings(patch) {
  const cur = canvasSettings() || { id: SETTINGS_ID, map: {} };
  await store.put('setting', { ...cur, ...patch });
}

// ---------- ICS parsing ----------
const unescapeText = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

export function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      cur[name.toUpperCase()] = { value: line.slice(i + 1), params: params.join(';') };
    }
  }
  return events;
}

/** DTSTART -> local { date, time }. UTC ("Z") times convert to this device's time zone. */
export function parseDT(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  if (/VALUE=DATE(?!-)/i.test(prop.params) || /^\d{8}$/.test(v)) {
    return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', z] = m;
  const dt = z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)) : new Date(+y, mo - 1, +d, +h, +mi, +s);
  return { date: iso(dt), time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` };
}

export function guessType(title) {
  const t = title.toLowerCase();
  if (/\b(midterm|exam)\b/.test(t)) return 'exam';
  if (/\bquiz/.test(t)) return 'quiz';
  if (/\b(project|essay|paper|draft|presentation|report|portfolio)\b/.test(t)) return 'project';
  if (/\b(final|test)\b/.test(t)) return 'exam'; // "Final", "Unit 3 test" — after "final draft" etc.
  if (/\blab\b/.test(t)) return 'lab';
  if (/\b(read|reading|chapter)\b|\bch\.?\s?\d/.test(t)) return 'reading';
  return 'hw';
}

/** Canvas summaries look like "Homework 3 [MATH-1C-01Y]": split off the course in brackets. */
function splitSummary(summary) {
  const s = unescapeText(summary).trim();
  const m = s.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return m ? { title: m[1].trim(), course: m[2].trim() } : { title: s, course: 'Other' };
}

/** Assignments + exam-like calendar events from a Canvas feed. */
export function extractItems(text) {
  const out = [];
  for (const ev of parseICS(text)) {
    const uidv = ev.UID?.value || '';
    const { title, course } = splitSummary(ev.SUMMARY?.value || '');
    if (!title) continue;
    const isAssignment = /assignment/i.test(uidv);
    if (!isAssignment && !/\b(midterm|final|exam|quiz|test)\b/i.test(title)) continue;
    const when = parseDT(ev.DTSTART) || parseDT(ev.DUE);
    if (!when) continue;
    out.push({
      key: uidv || `${course}|${title}|${when.date}`,
      title, course, due: when.date, time: when.time,
      url: ev.URL?.value || '',
      type: guessType(title),
    });
  }
  return out;
}

// ---------- course ↔ class matching ----------
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
/**
 * Course codes spotted in a Canvas course name. Handles De Anza's style:
 * "F26 MATH D001C 01Y" -> ["MATH 1C"], "CIS-22C-02W" -> ["CIS 22C"].
 */
export function courseCodes(course) {
  const out = [];
  const re = /\b([A-Z]{2,5})[\s_-]*D?0*(\d{1,3}[A-Z]{0,2})\b/g;
  let m;
  while ((m = re.exec(course.toUpperCase()))) out.push(`${m[1]} ${m[2]}`);
  return out;
}
/** Best guess: one of your classes whose code matches a code in the Canvas course name. */
export function suggestClass(course) {
  const codes = courseCodes(course).map(norm);
  return classes().find((c) => c.code && codes.includes(norm(c.code)));
}

function nextFreeColor() {
  const used = new Set(classes().map((c) => c.color));
  return Object.keys(COLORS).find((k) => k !== 'ink' && !used.has(k)) || 'cobalt';
}
export async function createClassFor(course) {
  const id = uid();
  const code = courseCodes(course)[0] || course.slice(0, 16);
  await store.put('class', { id, code, name: course, color: nextFreeColor(), room: '', meetings: [] });
  return id;
}

// ---------- fetching + importing ----------
async function fetchFeed(url) {
  const sb = getClient();
  if (!sb || !syncState.signedIn) throw new Error('Sign in under Settings → Sync first. Canvas import runs through your account.');
  const { data, error } = await sb.functions.invoke('canvas-feed', { body: { url } });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context.json();
      msg = body.error || body.message || msg;
      if (error.context.status === 404 && !body.error) msg = 'The canvas-feed function isn’t set up in Supabase yet (see README → Canvas import).';
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  if (typeof data !== 'string' || !data.includes('BEGIN:VCALENDAR')) throw new Error('Canvas didn’t return a calendar');
  return data;
}

/**
 * Fetch (or reuse the last fetch) and import. Returns
 * { added, updated, unmapped: [course names needing a choice], total }.
 */
export async function runImport({ refetch = true } = {}) {
  if (running) return running;
  running = (async () => {
    const s = canvasSettings();
    if (!s?.url) throw new Error('No Canvas feed connected');
    if (refetch || !lastFeed) lastFeed = await fetchFeed(s.url);
    return importText(lastFeed);
  })();
  try { return await running; }
  catch (e) { await saveSettings({ lastError: e.message }); throw e; }
  finally { running = null; }
}

/** Import an already-downloaded feed (also handy for testing). */
export async function importText(text) {
  lastFeed = text;
  const s = canvasSettings() || {};
  const items = extractItems(text);

  const map = { ...(s.map || {}) };
  const counts = {};
  for (const it of items) counts[it.course] = (counts[it.course] || 0) + 1;
  // First sight of a course: auto-match by class code when it's obvious.
  for (const course of Object.keys(counts)) {
    if (!(course in map)) {
      const guess = suggestClass(course);
      if (guess) map[course] = guess.id;
    }
  }

  const batch = [];
  let added = 0, updated = 0;
  for (const it of items) {
    const classId = map[it.course];
    if (!classId || classId === 'skip' || !store.get(classId)) continue;
    const id = 'canvas-' + it.key.replace(/[^A-Za-z0-9_-]/g, '_');
    if (store.raw(id)?.deleted) continue; // you deleted it; don't bring it back
    const snap = { title: it.title, due: it.due, time: it.time, classId };
    const cur = store.get(id);
    if (!cur) {
      batch.push(['assignment', { id, ...snap, type: it.type, url: it.url, notes: '', done: false, source: 'canvas', canvas: snap }]);
      added++;
    } else {
      // Only take fields Canvas changed since the last import, so your own edits stick.
      const changes = {};
      for (const f of ['title', 'due', 'time', 'classId']) if ((cur.canvas || {})[f] !== snap[f]) changes[f] = snap[f];
      if (Object.keys(changes).length) {
        batch.push(['assignment', { ...cur, ...changes, url: it.url || cur.url, canvas: snap }]);
        updated++;
      }
    }
  }
  if (batch.length) await store.putMany(batch);

  const courses = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  const unmapped = courses.filter((c) => !map[c.name]).map((c) => c.name);
  await saveSettings({ map, courses, lastImport: new Date().toISOString(), lastResult: { added, updated, total: items.length }, lastError: '' });
  return { added, updated, unmapped, total: items.length };
}

export async function connect(url) {
  const clean = url.trim().replace(/^webcal:/i, 'https:');
  let u;
  try { u = new URL(clean); } catch { throw new Error('That doesn’t look like a link'); }
  if (!/instructure\.com$/i.test(u.hostname) || !u.pathname.startsWith('/feeds/calendars/')) {
    throw new Error('Use the Calendar Feed link from Canvas (it contains /feeds/calendars/)');
  }
  await saveSettings({ url: clean });
  return runImport();
}

export async function disconnect() {
  lastFeed = null;
  await saveSettings({ url: '', courses: [], lastResult: null, lastError: '' });
}

export async function setMapping(course, value) {
  const s = canvasSettings() || {};
  let classId = value;
  if (value === 'new') classId = await createClassFor(course);
  await saveSettings({ map: { ...(s.map || {}), [course]: classId } });
  return runImport({ refetch: false });
}

/** Called on launch / foreground: re-import at most once an hour. */
export async function maybeAutoImport(onResult) {
  const s = canvasSettings();
  if (!s?.url || !syncState.signedIn || running) return;
  if (s.lastImport && Date.now() - new Date(s.lastImport).getTime() < AUTO_EVERY_MIN * 60_000) return;
  try { onResult?.(await runImport()); } catch (e) { console.warn('[canvas]', e.message); }
}
