// Supabase sync: push dirty local records, pull anything newer from the server,
// and listen for realtime changes so the other device updates live.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { store } from './store.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const PAGE = 500;

let sb = null;
let session = null;
let channel = null;
let running = null;
let again = false;
let debounce = null;
const listeners = new Set();

export const syncState = {
  configured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
  signedIn: false,
  email: '',
  status: 'off', // off | idle | syncing | offline | error
  lastSync: null,
  error: '',
};

function set(changes) {
  Object.assign(syncState, changes);
  for (const fn of listeners) fn(syncState);
}
export function onSyncState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function initSync() {
  if (!syncState.configured) return;
  try {
    const { createClient } = await import(SDK_URL);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    // Offline on first launch: the SDK isn't cached yet. Stay local and retry when online.
    set({ status: 'offline', error: 'Sync library not loaded yet' });
    window.addEventListener('online', () => location.reload(), { once: true });
    return;
  }
  const { data } = await sb.auth.getSession();
  applySession(data.session);
  sb.auth.onAuthStateChange((_evt, s) => applySession(s));

  store.onChange((src) => { if (src === 'local') schedule(); });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => set({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60_000);
}

function applySession(s) {
  const wasIn = syncState.signedIn;
  session = s;
  set({ signedIn: !!s, email: s?.user?.email || '', status: s ? 'idle' : 'off' });
  if (s && !wasIn) { subscribe(); syncNow(); }
  if (!s && channel) { sb.removeChannel(channel); channel = null; }
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('records-' + session.user.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${session.user.id}` },
      (payload) => { if (payload.new?.id) store.applyRemote([payload.new]); })
    .subscribe();
}

function schedule() {
  clearTimeout(debounce);
  debounce = setTimeout(syncNow, 700);
}

export async function syncNow() {
  if (!sb || !session) return;
  if (!navigator.onLine) { set({ status: 'offline' }); return; }
  if (running) { again = true; return running; }
  running = (async () => {
    set({ status: 'syncing', error: '' });
    try {
      await push();
      await pull();
      set({ status: 'idle', lastSync: new Date() });
    } catch (e) {
      console.warn('[sync]', e);
      set({ status: 'error', error: e.message || String(e) });
    } finally {
      running = null;
      if (again) { again = false; schedule(); }
    }
  })();
  return running;
}

async function push() {
  const dirty = store.dirty();
  if (!dirty.length) return;
  const uid = session.user.id;
  for (let i = 0; i < dirty.length; i += PAGE) {
    const chunk = dirty.slice(i, i + PAGE);
    const rows = chunk.map((r) => ({ user_id: uid, id: r.id, kind: r.kind, data: r.data, deleted: r.deleted, updated_at: r.updated_at }));
    const { error } = await sb.from('records').upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw error;
    await store.markClean(chunk);
  }
}

async function pull() {
  const key = 'lastPull:' + session.user.id;
  let since = (await store.getMeta(key)) || '1970-01-01T00:00:00Z';
  // Small overlap guards against rows committed slightly out of order. Merging is idempotent.
  const overlap = new Date(new Date(since).getTime() - 5000).toISOString();
  let cursor = overlap;
  for (;;) {
    const { data, error } = await sb.from('records')
      .select('id,kind,data,deleted,updated_at,server_updated_at')
      .gt('server_updated_at', cursor)
      .order('server_updated_at', { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    if (!data.length) break;
    await store.applyRemote(data);
    cursor = data[data.length - 1].server_updated_at;
    if (cursor > since) since = cursor;
    if (data.length < PAGE) break;
  }
  await store.setMeta(key, since);
}

// ----- Auth: email one-time code -----
// A 6-digit code (not just a link) matters on iPhone: home-screen apps don't share
// storage with Safari, so a magic link would sign in Safari instead of the app.
export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}
export async function verifyCode(email, token) {
  const { error } = await sb.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
  if (error) throw error;
}
export async function signOut() {
  await sb.auth.signOut();
}
