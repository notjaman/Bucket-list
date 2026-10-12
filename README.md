# Bucket List

Shared bucket lists for friend groups. The home screen lets you **create** a list or **join** one with its code. Inside a list, everyone records items under their name, with a target date, status, category and notes.

**How sharing works:** each list has an 8-character code, and its link is `https://<site>/#<code>`. There is no login: **whoever has the code can view, edit and delete in that list**, so share it only with the group. The home screen remembers the lists you've opened on that device.

- **Frontend:** plain HTML/CSS/JS in `public/`
- **API:** one Netlify Function, `netlify/functions/api.mjs`, served at `/api/lists`
- **Database:** Supabase Postgres. The function talks to it with the secret key; the browser never sees a Supabase key.

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/lists` | `{title}` | 201 + `{code, title}` |
| GET | `/api/lists/:code` | | `{code, title, created_at, items}`, items newest first |
| POST | `/api/lists/:code/items` | `{name, item, target_date?, status?, category?, notes?}` | 201 + row |
| PATCH | `/api/lists/:code/items/:id` | the full editable row (omitted optional fields are cleared) | 200 + row |
| DELETE | `/api/lists/:code/items/:id` | | 204 |

Errors come back as `{ "error": "..." }`:
- 400 for bad input, a bad id or invalid JSON
- 404 for an unknown list code, or an item that isn't in that list
- 405 for a wrong method
- 429 when the rate limit is hit (60 requests a minute per IP, which also makes guessing codes impractical)

`completed_at` is set by a database trigger when status becomes Done and cleared if the status moves back.

## Setup

1. **Supabase**
   1. Create a project. Pick region **East US (Ohio)**, which is next to Netlify's default function region.
   2. Open the SQL editor and run `db/schema.sql`.
   3. Under Settings → API Keys, copy the **Project URL** and a **secret key** (`sb_secret_…`).
2. **GitHub:** commit, then `git push -u origin main`.
3. **Netlify**
   1. `npx netlify login`
   2. `npx netlify init`: connect this repo. Leave the build command empty; the publish directory is `public`.
   3. `npx netlify env:set SUPABASE_URL https://<project>.supabase.co`
   4. `npx netlify env:set SUPABASE_SECRET_KEY sb_secret_… --secret`
4. **Local dev:** `cp .env.example .env`, fill in the two values, then run `npm run dev` and open http://localhost:8888. This talks to the real Supabase database.
5. **Deploy:** push to `main`.

## Tests

```sh
npm test
```

## Limits to know about

- **Supabase free projects pause after 1 week with no activity.** The site then shows "Database error" until you click *Restore* in the Supabase dashboard. Data is kept.
  - If this gets annoying, add a daily Netlify scheduled function that runs one `select`.
- **The free plan has no automatic backups,** and anyone with the link can delete. Back up now and then:
  ```sh
  npx supabase db dump --db-url "<connection string from Supabase → Connect>" --data-only -f backup.sql
  ```
- Two people editing the same item at once: last save wins. The list refreshes when you switch back to the tab.
- Opening a list loads all of its items (Supabase caps a response at 1000 rows). That is plenty for a friend group.
- Lists can't be renamed or deleted from the app yet. Do it in the Supabase table editor; deleting a list deletes its items.
