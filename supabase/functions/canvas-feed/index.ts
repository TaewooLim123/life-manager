// Supabase Edge Function: canvas-feed
// Canvas calendar feeds (.ics) don't send CORS headers, so the browser can't fetch them
// directly. This function fetches the feed server-side and hands the text back.
//
// Locked down so it can't be used as an open proxy:
//   - only signed-in users (keep "Verify JWT" ON when deploying)
//   - only https://*.instructure.com/feeds/calendars/... URLs
//   - only responses that are actually iCalendar data

const ALLOWED_HOST = /(^|\.)instructure\.com$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const allowed = (u: URL) =>
  u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname) && u.pathname.startsWith('/feeds/calendars/');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'Use POST');

  let target: URL;
  try {
    const { url } = await req.json();
    target = new URL(String(url).trim().replace(/^webcal:/i, 'https:'));
  } catch {
    return fail(400, 'Send JSON like {"url": "https://<school>.instructure.com/feeds/calendars/user_….ics"}');
  }
  if (!allowed(target)) return fail(400, 'Only Canvas calendar feed links (…instructure.com/feeds/calendars/…) are allowed');

  let res: Response;
  try {
    res = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': 'LifeManager/1.0 (calendar import)' } });
  } catch (e) {
    return fail(502, `Couldn't reach Canvas: ${e instanceof Error ? e.message : e}`);
  }
  if (!allowed(new URL(res.url))) return fail(502, 'Canvas redirected somewhere unexpected');
  if (!res.ok) return fail(502, res.status === 404 ? 'Canvas says this feed link doesn’t exist. Copy it again from Canvas → Calendar → Calendar Feed.' : `Canvas returned ${res.status}`);

  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) return fail(502, 'That link didn’t return a calendar');

  return new Response(text, { headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
});
