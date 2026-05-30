# Deploying FairFund v2

FairFund v2 is a **fully static site** — no backend, no server-side secrets, no
shared API keys. The AI assistant works out of the box using a built-in engine
grounded in the fund data, and any user can optionally add their **own** API key
(stored only in their browser) for fuller conversational replies.

That means it deploys anywhere static hosting is offered — all free:

| Host | Notes |
|------|-------|
| **Vercel** | Connect the Git repo; auto-deploys on every push. Recommended. |
| **GitHub Pages** | Free workflow included (`.github/workflows/deploy.yml`). |
| **Netlify / Cloudflare Pages** | Connect repo or drag-and-drop the `dist` folder. |

---

## Option 1 — Vercel (recommended)
1. Push this folder to a GitHub repo.
2. On [vercel.com](https://vercel.com): **Add New → Project → import the repo.**
3. Vercel auto-detects Vite. Build: `npm run build`. Output: `dist`. Deploy.
4. Done. Auto-deploys on every push. No env vars needed.

## Option 2 — GitHub Pages (no server, free forever)
The included workflow `.github/workflows/deploy.yml` builds and deploys on push.
1. Push to GitHub.
2. Repo → **Settings → Pages → Source: GitHub Actions.**
3. Push to `main`. Live at `https://<username>.github.io/<repo>/`.

## Option 3 — Netlify Drop (no Git needed)
1. Run `npm run build` locally.
2. Drag the `dist` folder into [app.netlify.com/drop](https://app.netlify.com/drop). Instant URL.

---

## AI assistant — how it works (no key required)
- **Default:** a built-in, deterministic engine answers questions about funds,
  metrics, and the methodology using the bundled data. No key, no network call to
  any AI provider.
- **Optional upgrade:** a user can paste their own OpenAI-compatible API key via the
  chat ⚙️ settings. It's stored only in their browser (`localStorage`) and used only
  for their own session. FairFund never sees it — there are no servers.
