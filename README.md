# Life Manager

A phone-first life manager for a student: **classes & assignments, tasks, habits, and a weekly schedule**, plus a daily balance check. It's plain HTML/CSS/JS with no build step. You can install it on the iPhone home screen or the Mac Dock, it works offline, and it can sync between devices through Supabase.

## Screens

| Tab | What it does |
| --- | --- |
| **Today** | The most urgent deadline as a big countdown card, everything due today and tomorrow, today's classes and blocks with a NOW line, habit check-ins, and a balance bar (class / study / work / health / free). |
| **School** | Assignments grouped by day (Overdue → Today → … → Later), or a grid of class cards. Tap a class to see its meeting times and open work. |
| **Tasks** | Non-school to-dos. Quick-add understands `tomorrow`, `fri`, `next week` and `!` (high priority). |
| **Habits** | Tap to check off today. Shows streaks, your best run and a 7-day grid; tap a past day to fix it. |
| **Week** | Timetable built from class meeting times plus repeating study, gym and work blocks. On phone you see one day at a time; on desktop, all 7 days. |

Mac keyboard shortcuts: `N` creates a new item, `1`–`5` switch tabs, `Esc` closes a sheet.

## Run locally

```bash
python3 -m http.server 5178 --bind 127.0.0.1
```

Then open http://127.0.0.1:5178. In Settings, **Load sample week** fills the app with demo data.

## Put it on your iPhone

The app has to be served over HTTPS for the home-screen install and offline mode, and GitHub Pages does that for free:

1. Create a GitHub repo (e.g. `life-manager`) and push this folder to it.
2. In the repo, go to **Settings → Pages → Deploy from a branch → `main` / root**.
3. On the iPhone, open `https://<your-username>.github.io/life-manager/` in **Safari**, then Share → **Add to Home Screen**.
4. On the Mac, open the same URL in Safari and choose File → **Add to Dock** (or use Chrome's Install button).

When you ship changes, bump `VERSION` in `sw.js` (e.g. `lm-v2`) so phones pick up the new files.

## Turn on sync (iPhone ↔ Mac)

Until you do this, data stays on each device separately. You can still move it with **Export / Import backup** in Settings.

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. **Authentication → Emails (Templates)**: in both **Magic Link** and **Confirm signup**, add the line `Your code: {{ .Token }}`.
   The app signs you in with a code rather than a link. On iPhone, a home-screen app doesn't share storage with Safari, so tapping a link would sign in Safari instead of the app.
4. **Authentication → URL Configuration**: set the Site URL to your GitHub Pages URL.
5. **Project Settings → API**: copy the Project URL and the `anon` public key into [`js/config.js`](js/config.js), then commit and push. The anon key is meant to be public; row-level security means only your signed-in account can read your rows.
6. In the app, open Settings → Sync, enter your email, then type the code. Repeat on your other device with the same email.
7. Optional hardening: once both devices are signed in, turn off **Allow new users to sign up** (Authentication → Providers → Email) so nobody else can create an account.

### How sync works
- Every edit is saved to IndexedDB first, so the app is instant and works offline. The edit is marked "dirty".
- When you're online, dirty records are upserted to the `records` table, then anything newer is pulled from the server. This runs after edits, when the app comes back to the foreground, every 60 seconds, and on realtime events from your other device.
- If two devices edit the same item, the newest edit wins (by `updated_at`). Habit check-ins are separate records, so checking habits on two devices never conflicts.

## Files

```
index.html            app shell
styles.css            design system (tokens, light/dark, components)
js/app.js             routing, events, keyboard shortcuts, boot
js/views.js           the five screens
js/sheet.js           add/edit forms, class detail, settings
js/model.js           derived data: due lists, schedule, streaks, sample data
js/store.js           IndexedDB store with dirty tracking
js/sync.js            Supabase push/pull/realtime + email-code sign-in
js/config.js          Supabase URL + anon key (blank = local only)
sw.js                 offline cache
supabase/schema.sql   database table, security rules, realtime
tools/make_icons.py   regenerates icons/ (pure Python, no dependencies)
```
