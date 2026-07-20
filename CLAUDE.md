# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

均衡日記（DietDiary）is a mobile-first diet-diary web app: a React 19 SPA (`frontend/`) talking to a Node/Express + SQLite API (`backend/`), with an optional Python embedding microservice (`embedding-service/`) and AI features via an external OpenAI-compatible LLM gateway. See `README.md` for the product overview and `DEVELOPMENT.md` for the full API table and account flows.

## Commands

```bash
# Local dev (two terminals)
cd backend  && npm install && npm run dev   # tsx watch, port 3001
cd frontend && npm install && npm run dev   # vite, port 5173 (proxies /api + /uploads → 3001)
# → browse http://localhost:5173

# Build
cd backend  && npm run build   # tsc → dist/
cd frontend && npm run build   # tsc -b && vite build → dist/

# Lint (frontend only; oxlint). Backend has no linter.
cd frontend && npm run lint

# Docker (production topology; port 8080)
cp .env.example .env           # set JWT_SECRET, SMTP, LLM_TOKEN…
docker compose up -d --build
docker compose --profile embed up -d --build   # also start the embedding service (KB)

# Version bump (updates BOTH package.json files at once)
node scripts/bump-version.mjs X.Y.Z
```

- **There is no test framework** in either package — do not look for or invent test commands.
- Node is not always on `PATH` in this environment; if `node`/`npm` aren't found, they live in `/usr/local/bin`.
- Releasing is scripted by the `release` skill (bump → changelog → build → commit → push → GitHub Release). New version **must be strictly greater** than the deployed one or the force-update won't fire.

## Serving topology (dev ≠ prod, but API paths are identical)

The **frontend nginx container is the only public entry point** (host `8080` → nginx `80`). It serves the static SPA and reverse-proxies `/api` and `/uploads` to `backend:3001`; the backend has no published port. In dev, Vite's proxy plays nginx's role. Because of this, **the API client uses relative paths only** (`/api/...`, `frontend/src/lib/api.ts`) — there is no configurable base URL. `frontend/nginx.conf` also rate-limits `/api/auth/` and gives `/api/ai/` a 150s timeout (LLM can stall ~45s then fall back).

## Architecture

**Frontend** — React 19 + Vite 8 + Zustand, no router, no CSS framework (inline styles + `index.css`).
- `frontend/src/App.tsx` picks the screen from Zustand state (`view` + `role` + `modal`), not URLs. Single store in `store.ts` holds all auth/day/goals/notifications state and owns every API call.
- `frontend/src/lib/domain.ts` is the **single source of truth for nutrition math** (the `KCAL` table, `DEFAULT_GOALS`, the over-goal red-line rule). The backend **only stores portions and does not compute kcal for display** — but see the duplication gotcha below.
- **Six categories vs eleven fields**: entries store 11 `FoodKey` portion fields that collapse into 6 `GoalKey` categories (`meat` = 4 fat levels, `milk` = 3). This 11→6 mapping recurs across frontend and backend.

**Backend** — Node/Express + better-sqlite3 (synchronous, single file, WAL).
- `backend/src/db.ts` holds the schema **and** all idempotent migrations (inline `ALTER TABLE` / table rebuilds run on boot). When changing schema, add a migration here rather than editing a `CREATE TABLE` in place.
- Auth is **stateless JWT** (`middleware/auth.ts`): `requireAuth` sets `req.userId`; `requireRole(...)` re-reads role/status **from the DB on every call** so admin role changes take effect live. AI endpoints add `requireAI` (per-user `ai_enabled` flag). Roles: `member` / `citizen` (== member) / `dietitian` / `admin`.
- `routes/pro.ts` mirrors the member routes but scoped to `/members/:id/...` for dietitians; dietitian-set goals carry `set_by='dietitian'` and members cannot edit them.
- `days` table's `water`/`ex_*` columns are **caches recomputed from `water_logs`/`ex_logs`** (water & exercise became per-record logs) — write through the log tables, not the cache.

**Photos** — uploaded via multer memory storage, **EXIF-stripped** (`helpers.stripJpegExif`; the gateway 500s on EXIF JPEGs + privacy), written to `UPLOAD_DIR` as `e{entryId}-{ts}-{i}.jpg`. DB stores only URL paths in `entries.photos`. Frontend pre-compresses to 640px / q0.7 (`lib/photo.ts`). Per-photo portions live in `photo_foods`; older entries fall back to the whole-entry `food` on the first photo.

**AI subsystem** (`backend/src/llm.ts`, `kb.ts`, `routes/ai.ts`) — entirely gated by `LLM_TOKEN` (unset ⇒ all AI disabled) and per-user `ai_enabled`.
- `llm.ts`: gateway client (OpenAI-compatible), model chain (`gemma-4-31b` vision, `gemma-4-12b` text, `gemma-4-e4b` fallback), and image down-compression to fit the gateway's ~68 KB image budget.
- `kb.ts`: the optional **shared dish knowledge base** (community-consensus portions via text+image embeddings from `embedding-service`). Every KB call **no-ops/swallows errors when inactive or the embedder is down**, so it never breaks OCR. Requires `AI_KB_ENABLED=true` + `AI_EMBED_URL`.
- Endpoints: `/api/ai/ocr` (photo → portions + caption), `/comment` (per-meal note), `/daily` (whole-day summary), `/feedback` (👍/👎 that steers future generations).

## Gotchas

- **Nutrition constants are duplicated.** `frontend/src/lib/domain.ts` has `KCAL` and the goal defaults; `backend/src/routes/ai.ts` **re-declares its own `KCAL` and default-goal constants** for building AI prompts. Change serving rules in **both** or AI comments will disagree with the UI.
- **Version must be in sync** across `frontend/package.json` and `backend/package.json` (that's why `scripts/bump-version.mjs` writes both). Mismatch causes a force-update loop.
- **Changelog single source** is `frontend/public/changelog.json` (newest-first). The footer bundles it; the force-update modal live-fetches `/changelog.json` so stale bundles still show new notes. Add a new entry there on every release.
- **Prototype files** `均衡日記-standalone.html`, `飲食紀錄.dc.html`, `support.js` are the original design prototypes — reference only, not part of the build.
