# Kintsugi Network — Implementation

## Architecture
- **Backend** — Node.js/Express on Render (`backend/`)
- **Frontend** — React + Vite on GitHub Pages (`frontend/`)
- **Database** — Supabase (data + image storage + realtime)
- **AI** — OpenRouter (Claude for prompts, FLUX for images)
- **Forms** — Google Forms → Google Sheets → backend poller

---

## Phases

### Phase 1 — Scaffold & Infrastructure ✅
Backend Express server, WebSocket broadcast, frontend Vite+React skeleton, GitHub Actions deploy pipeline.

**Key files:**
- `backend/src/index.js` — Express + WebSocket server
- `backend/supabase-schema.sql` — run this in Supabase SQL editor once
- `frontend/vite.config.js` — sets `base: '/113-Final/'` for GitHub Pages
- `.github/workflows/deploy.yml` — auto-deploys on push to main

### Phase 2 — Data Pipeline ✅
Google Sheets polling, Claude prompt generation, FLUX image generation, Supabase Storage upload, seam label generation.

**Key files:**
- `backend/src/pipeline.js` — full `processFormResponse()` + `generateLODLevel()`
- `backend/src/openrouter.js` — Claude + FLUX API calls with retry
- `backend/src/storage.js` — Supabase Storage upload
- `backend/src/sheets.js` — Google Sheets 60s poller

### Phase 3 — Shard Geometry 🔲
Shared `ShardGeometry` (convex polygon, normalized 0-1) used by both PixiJS and Three.js renderers.

### Phase 4 — 2D Mosaic View 🔲
PixiJS canvas with pixi-viewport, rbush spatial index, LOD management, glass shard rendering (bevel + reflection + shadow), gold seams, Supabase realtime.

### Phase 5 — 3D Pottery View 🔲
React Three Fiber scene, LatheGeometry pottery shapes (7 archetypes), Voronoi tiling, shard mesh projection, gold TubeGeometry seams.

### Phase 6 — Transition Animation 🔲
GSAP timeline: shards lift → converge → land on pottery → gold seams grow.

### Phase 7 — UI Shell 🔲
Full-screen dark void, bottom pill controls, view toggle, zoom hints.

---

## Setup Checklist

### Supabase
1. Create project at supabase.com
2. Run `backend/supabase-schema.sql` in SQL editor
3. Create storage bucket named `shards` (public)
4. Copy `Project URL` and `service_role` key

### OpenRouter
1. Create account at openrouter.ai
2. Add credits (~$5 for testing)
3. Copy API key

### Google Sheets
1. Create Google Form with fields: Category (dropdown: regret/proud/half-finished), Response
2. Link to a Google Sheet
3. Create Google Cloud service account, download JSON credentials
4. Share the Sheet with the service account email

### Backend (local)
```bash
cd backend
cp .env.example .env   # fill in your keys
npm install
npm run dev            # runs on http://localhost:3001
```

### Frontend (local)
```bash
cd frontend
cp .env.example .env.local   # fill in your keys
npm install
npm run dev                   # runs on http://localhost:5173
```

### Render Deploy
1. Connect repo to Render
2. Set root directory: `backend`
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all env vars from `.env.example`

### GitHub Pages Deploy
1. Add secrets in repo Settings → Secrets → Actions:
   - `VITE_API_URL` — your Render backend URL
   - `VITE_WS_URL` — your Render backend WS URL (replace https with wss)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Push to main — GitHub Actions builds and deploys automatically
3. Enable GitHub Pages in repo Settings → Pages → Source: `gh-pages` branch
