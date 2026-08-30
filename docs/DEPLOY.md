# Deploying ChordCraft

| Piece | Where | Notes |
|---|---|---|
| Web app (`web/`) | Vercel | Static Vite build; talks to the API at `VITE_API_URL` |
| API (`api/`) | Railway | Docker image; runs migrations on start; health check `/health` |
| Worker (`api/`) | Railway | Same image, start command `arq app.worker.WorkerSettings` |
| Redis | Railway | Added from Railway's database templates |
| Postgres, sign-in | Supabase | The project's database, plus auth (email sign-in links) |

Everything deploys from the GitHub repo, so pushing to `main` redeploys.

## 1. Supabase (database and sign-in)

1. Create a project at supabase.com, in the region you'll run the API in.
2. **Authentication → URL Configuration**: set the Site URL to your Vercel URL (you'll have it
   after step 3; `http://localhost:5173` works for local testing) and add it to the redirect
   URLs.
3. **Authentication → Emails → SMTP Settings**: connect a sender such as Resend (free tier,
   with a domain you own verified there): host `smtp.resend.com`, port `465`, username
   `resend`, password a Resend API key. Supabase's built-in sender only reaches your own team's
   addresses, a couple of emails an hour; with custom SMTP the limit rises to 30 an hour
   (**Rate Limits**).
4. From **Project Settings → API**, note the project URL and the publishable (anon) key.
5. From **Connect**, copy the **Session pooler** connection string and fill in the database
   password. (The direct connection is IPv6-only, which Railway can't reach by default.)
6. Optional: the app talks to Postgres directly, so you can turn off the Data API under
   **Project Settings → Data API**.

The API verifies tokens with the project's published signing keys, so it only needs the
project URL. (`SUPABASE_JWT_SECRET` is only for projects still on the legacy shared secret.)

## 2. Railway (API, worker, Redis)

1. New project → **Deploy from GitHub repo** → this repo. In the service's **Settings**, set
   **Root Directory** to `/api` (Railway finds the Dockerfile there) and pick the region
   closest to your Supabase project.
2. Add **Redis** to the project.
3. On the API service, set variables in **Variables → Raw Editor**:

   ```
   DATABASE_URL=postgresql://postgres.<project>:<password>@<region>.pooler.supabase.com:5432/postgres
   REDIS_URL=${{Redis.REDIS_URL}}
   ANTHROPIC_API_KEY=sk-ant-...
   AGENT_MODEL=claude-sonnet-5-5
   AGENT_EFFORT=medium
   SUPABASE_URL=https://<project>.supabase.co
   CORS_ORIGINS=["https://<your-app>.vercel.app"]
   ```

   Then **Settings → Networking → Generate Domain** (port 8080) for a public URL. Migrations
   run on every start.
4. Add a second service from the same repo for the worker (**Add → GitHub Repository**). In
   its **Settings**: Root Directory `/api`, the same region, and **Custom Start Command**
   `arq app.worker.WorkerSettings`. Don't generate a domain. Its variables can point at the
   API service's, so keys live in one place (use your API service's name):

   ```
   DATABASE_URL=${{chordcraft-v1.DATABASE_URL}}
   REDIS_URL=${{chordcraft-v1.REDIS_URL}}
   ANTHROPIC_API_KEY=${{chordcraft-v1.ANTHROPIC_API_KEY}}
   AGENT_MODEL=${{chordcraft-v1.AGENT_MODEL}}
   AGENT_EFFORT=${{chordcraft-v1.AGENT_EFFORT}}
   ```

   Ignore Railway's "Suggested Variables" (they come from `.env.example` and point at
   localhost). The worker's logs should show `Starting worker for 1 functions: run_edit_job`.

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
