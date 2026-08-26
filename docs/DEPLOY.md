# Deploying ChordCraft

| Piece | Where | Notes |
|---|---|---|
| Web app (`web/`) | Vercel | Static Vite build; talks to the API at `VITE_API_URL` |
| API (`api/`) | Railway | Docker image; runs migrations on start; health check `/health` |
| Worker (`api/`) | Railway | Same image, start command `arq app.worker.WorkerSettings` |
| Postgres, Redis | Railway | Add both from Railway's database templates |
| Sign-in | Supabase | Auth only (email links, optionally GitHub) |

Everything deploys from the GitHub repo, so pushing to `main` redeploys.

## 1. Supabase (sign-in)

1. Create a project at supabase.com.
2. **Authentication → URL Configuration**: set the Site URL to your Vercel URL (you'll have it
   after step 3; `http://localhost:5173` works for local testing) and add it to the redirect
   URLs.
3. Optional: **Authentication → Providers → GitHub** to enable "Continue with GitHub".
4. From **Project Settings → API**, note the project URL and the publishable (anon) key.

The API verifies tokens with the project's published signing keys, so it only needs the
project URL. (`SUPABASE_JWT_SECRET` is only for projects still on the legacy shared secret.)

## 2. Railway (API, worker, Postgres, Redis)

1. New project → **Deploy from GitHub repo** → this repo. Set the service's **Root Directory**
   to `api`. Railway reads `api/railway.json` (Dockerfile build, `/health` check).
2. Add **Postgres** and **Redis** to the project.
3. On the API service, set variables (use Railway's reference variables for the databases):

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   ANTHROPIC_API_KEY=sk-ant-...
   AGENT_MODEL=claude-sonnet-5-5
   AGENT_EFFORT=medium
   SUPABASE_URL=https://<project>.supabase.co
   CORS_ORIGINS=["https://<your-app>.vercel.app"]
   ```

   Then **Settings → Networking → Generate Domain** for a public URL.
4. Add a second service from the same repo for the worker: Root Directory `api`, and under
   **Settings → Config-as-code** point it at `api/railway.worker.json` (same image, start
   command `arq app.worker.WorkerSettings`, no public domain). Give it the same variables
   (the worker doesn't need `CORS_ORIGINS` or `SUPABASE_URL`).

Postgres URLs from Railway or Supabase (`postgresql://…?sslmode=require`) work as they are;
the API converts them for asyncpg. Supabase's transaction pooler (port 6543) works too.

## 3. Vercel (web app)

1. New project → import this repo → **Root Directory** `web`. `web/vercel.json` sets the Vite
   build and the single-page-app rewrite (so `/scores/<id>` and `/new` load the app).
2. Environment variables:

   ```
   VITE_API_URL=https://<your-api>.up.railway.app
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable key>
   ```

3. Deploy, then put the Vercel URL into Supabase's Site URL (step 1.2) and the API's
   `CORS_ORIGINS` (step 2.3).

## Checking it

- `https://<your-api>/health` → `{"status":"ok","postgres":true,"redis":true}`
- Open the Vercel URL, sign in with the emailed link, and ask the agent for an edit (⌘K). If
  it stays on "Reading the music…", check the worker's logs on Railway.

## Notes

- Scores made locally (without sign-in) have no owner and won't appear for signed-in users.
- Each agent edit is a few cents on your Anthropic account; Tab suggestions about a cent each
  (they can be turned off in the toolbar).
