# Kintsugi Network

A living, crowd-sourced art installation where human vulnerability becomes collective beauty.

Participants submit responses to emotional prompts — a proudest moment, a biggest regret, an unfinished dream. Each response is transformed by AI into a unique surrealist artwork displayed as a jagged glass shard in an ever-growing mosaic. Their own words float over the image they inspired. The more people contribute, the more whole it becomes.

Inspired by the Japanese philosophy of Kintsugi — the art of repairing broken pottery with gold, treating fracture not as damage but as history worth honoring.

**[View Live →](https://solllllz.github.io/113-Final/)**

---

## What It Does

1. Participants fill out a Google Form with responses to emotional questions (proud moment, biggest regret, unfinished project, etc.)
2. The backend polls the linked Google Sheet every 60 seconds for new responses
3. Each response is sent to Claude (via OpenRouter) to generate a surrealist image prompt, then rendered by Pollinations AI (free, no API key required)
4. The image is uploaded to Supabase Storage and the shard is saved to a Supabase database
5. The frontend renders all shards as 3D glass pieces in an interactive mural using Three.js
6. Zoom into any shard to explore an infinite surrealist world — each zoom level reveals a new emotionally-layered scene generated from that person's story, with text overlays deepening from surface → symbolic → abstract
7. New shards appear in real time via Supabase Realtime

---

## Features I'm Most Proud Of

**Emotional Zoom Engine** — Zooming into a shard doesn't just show a bigger image. It generates 4 emotionally-structured depth layers from the person's original words: surface scene → expanded moment → internal/symbolic → core abstraction (3–8 words). Each layer has a text overlay that fades in, and after layer 4 the canvas fades to black and returns you to the mural. All 4 layers are generated upfront in the background the moment a shard is created, so the zoom is seamless.

**Zoomquilt-style infinite zoom** — Built on a 2D canvas using a crossfade technique: the current image blurs and fades out while the next world fades in at full-screen scale, eliminating the jarring "small square" artifact. Auto-advance with lerp smoothing gives the illusion of continuous motion.

**3D glass shards** — Each shard is a procedurally generated glass polygon using Three.js MeshPhysicalMaterial with transmission, IOR, and displacement-mapped front-face vertices. This tool 
so much degugging. Honestly I spent most of my time just trying to get my shards correct.

**Fully automated pipeline** — From Google Form submission to rendered shard on the live mural with no human intervention. The pipeline handles prompt generation, image generation, storage upload, database insert, seam label generation, and WebSocket broadcast in sequence.

---

## How to Use

Visit the live site and explore the mural:
- **Scroll** to zoom in/out
- **Click and drag** to pan
- **Zoom into a shard** until the camera is close enough — the infinite zoom activates automatically
- **Scroll down** at any point to exit the zoom and return to the mural

---

## Running Locally

### Prerequisites
- Node.js 20+
- A Supabase project (free tier works)
- An OpenRouter API key
- A Google Cloud service account with Sheets API access

### Backend

```bash
cd backend
npm install
```

Create `backend/.env`:
```
OPENROUTER_API_KEY=your_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173
```

```bash
npm start
```

### Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env`:
```
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

```bash
npm run dev
```

### Database

Run in the Supabase SQL editor:
```sql
CREATE TABLE shards (
  id UUID PRIMARY KEY,
  response_text TEXT,
  category TEXT,
  image_prompt TEXT,
  image_url TEXT,
  grid_x FLOAT,
  grid_y FLOAT,
  seed BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE shard_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shard_id UUID REFERENCES shards(id),
  level INT,
  image_url TEXT,
  prompt TEXT,
  focus_object TEXT,
  layer_text TEXT,
  seed BIGINT,
  width INT,
  height INT
);

CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shard_a UUID REFERENCES shards(id),
  shard_b UUID REFERENCES shards(id),
  seam_label TEXT,
  weight FLOAT
);

CREATE TABLE processed_rows (
  row_index INT PRIMARY KEY
);
```

---

## Secrets

| Secret | Where used | How handled |
|--------|-----------|-------------|
| `OPENROUTER_API_KEY` | Backend — Claude prompt generation | Render environment variable, never committed |
| `SUPABASE_SERVICE_KEY` | Backend — database writes | Render environment variable, never committed |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Backend — reading the Google Sheet | Render environment variable, never committed |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | Frontend — Realtime updates | GitHub Actions secrets, baked into static build (anon key is safe to expose) |

The `backend/.env` file is listed in `.gitignore` and never committed. The frontend production API URL is hardcoded in the GitHub Actions workflow since it is not sensitive.
