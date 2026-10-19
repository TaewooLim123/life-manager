# Life Manager

**Live:** https://taewoolim123.github.io/life-manager/

A phone-first life manager for a student: **classes & assignments, tasks, habits, and a weekly schedule**, plus a daily balance check. It's plain HTML/CSS/JS with no build step. You can install it on the iPhone home screen or the Mac Dock, it works offline, and it can sync between devices through Supabase.

## Screens

| Tab | What it does |
| --- | --- |
| **Today** | The most urgent deadline as a big countdown card, everything due today and tomorrow, exams and projects in the next two weeks, today's classes and blocks with a NOW line, habit check-ins, and a balance bar (class / study / work / health / free). |
| **School** | Assignments grouped by day (Overdue → Today → … → Later), or a grid of class cards. Tap a class to see its meeting times and open work. |
| **Lists** | **To-do**: non-school to-dos. Quick-add understands `tomorrow`, `fri`, `!` (high priority) and `every week` / `monthly`; finishing a repeating to-do moves it to its next date. **Groceries**: items sort into store aisles automatically; add several at once ("2 milk, eggs, bananas"); checked items go to *In cart*; *Clear* turns them into *Buy again* suggestions, ranked by how often you buy them. **Shopping**: the same for non-grocery things. |
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

1. Push to `main`. GitHub Pages (already enabled for this repo) redeploys in about a minute.
2. On the iPhone, open https://taewoolim123.github.io/life-manager/ in **Safari**, then Share → **Add to Home Screen**.
3. On the Mac, open the same URL in Safari and choose File → **Add to Dock** (or use Chrome's Install button).

When you ship changes, bump `VERSION` in `sw.js` (e.g. `lm-v2`) so phones pick up the new files.

## Turn on sync (iPhone ↔ Mac)

Until you do this, data stays on each device separately. You can still move it with **Export / Import backup** in Settings.

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. **Authentication → Sign In / Providers → Email**: turn **Confirm email** off.
   The app uses email + password with no emails sent, so you don't need custom SMTP. That also avoids magic links, which on iPhone would open Safari instead of the home-screen app.
4. **Authentication → URL Configuration**: set the Site URL to your GitHub Pages URL.
5. **Project Settings**: copy the Project URL (Data API) and the **publishable** key (`sb_publishable_…`, or the legacy `anon` key) into [`js/config.js`](js/config.js), then commit and push. That key is meant to be public; row-level security means only your signed-in account can read your rows. Never put the `secret` / `service_role` key in the app.
6. In the app, open Settings → Sync and tap **Create account** once. On your other device, **Sign in** with the same email and password.
7. Then turn off **Allow new users to sign up** (Authentication → Sign In / Providers) so nobody else can create an account.

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
js/lists.js           grocery + shopping lists (aisle sorting, buy-again)
js/sheet.js           add/edit forms, class detail, settings
js/model.js           derived data: due lists, schedule, streaks, sample data
js/store.js           IndexedDB store with dirty tracking
js/sync.js            Supabase push/pull/realtime + email-code sign-in
js/config.js          Supabase URL + anon key (blank = local only)
sw.js                 offline cache
supabase/schema.sql   database table, security rules, realtime
tools/make_icons.py   regenerates icons/ (pure Python, no dependencies)
```
