# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

I.R.I.S. (Improve Running Insight System) — self-hosted family web app for managing GPX activities (running, cycling, hiking). Deployed on a Proxmox VM via Docker Compose. 4 family users, no self-registration.

## Development & Deployment

All runtime happens inside Docker. There is no local Python environment.

**Start stack (on server at `/opt/iris`):**
```bash
docker compose up --build -d
```

**Rebuild after code changes (pull + rebuild):**
```bash
git pull && docker compose build --no-cache app && docker compose up -d
```

**View logs:**
```bash
docker compose logs -f app
docker compose logs app   # snapshot
```

**Run a one-off Python command inside the container:**
```bash
docker exec iris-app-1 python3 -c "..."
```

**Manual DB access:** Adminer at `http://<server>:8888` — connect with `db` as server, credentials from `.env`.

**Generate a password hash for a new user:**
```bash
docker exec iris-app-1 python3 -c "from app.auth import hash_password; print(hash_password('password'))"
```

## Architecture

### Request flow
Browser → FastAPI (`app/main.py`) → routers → services/models → MariaDB

Frontend is vanilla JS/HTML/CSS served as static files by FastAPI (`StaticFiles` mount at `/`). All data goes through the REST API at `/api/*`.

### Authentication
Cookie-based sessions via `starlette.middleware.sessions.SessionMiddleware`. `request.session["user_id"]` holds the logged-in user's ID. `get_current_user()` in `auth.py` is the FastAPI dependency used to protect routes. `require_admin()` extends it for admin-only endpoints. Passwords hashed with `bcrypt` directly (no passlib — incompatible with bcrypt 4.x+).

### GPX import pipeline
Two paths into the DB:
1. **Automatic (watcher):** `watchdog` Observer starts at app startup (lifespan), watches `/app/gpx` recursively. New `.gpx` files in `gpx/<user_id>/inbox/` trigger `_process()` in `watcher.py` → `parse_gpx()` → DB insert → file moved to `processed/` or `failed/`.
2. **Manual upload (Phase 4.2, not yet implemented):** browser upload endpoint.

User ID is derived from the folder path: `gpx/<user_id>/inbox/<file>.gpx`.

### Database
Schema initialized once via `db/init.sql` (MariaDB Docker entrypoint). SQLAlchemy is used ORM-style in `models.py` but migrations are manual SQL. Duplicate detection via `UNIQUE(user_id, start_time)` on the `activities` table — duplicate GPX imports raise an integrity error and go to `failed/`.

### Key files
| File | Purpose |
|---|---|
| `backend/app/config.py` | All settings read from `.env` via pydantic-settings |
| `backend/app/models.py` | SQLAlchemy models: `User`, `Activity`, `Trackpoint` |
| `backend/app/services/gpx_parser.py` | Pure function `parse_gpx(path)` → `ParsedActivity` dataclass |
| `backend/app/services/watcher.py` | Watchdog thread + DB write logic |
| `frontend/js/app.js` | All frontend logic (routing, API calls, Leaflet map) |

## Infrastructure

- Server: Ubuntu 25.04 VM in Proxmox, IP `192.168.178.168`
- Git remote: `https://github.com/anbic8/iris.git` (branch: `master`)
- App port: `8000`, Adminer port: `8888`
- GPX volume on host: `/opt/iris/gpx/` → `/app/gpx` in container
- `.env` is **not** in git — lives only on the server at `/opt/iris/.env`

## GPX folder structure on server
```
/opt/iris/gpx/
  <user_id>/
    inbox/      ← drop .gpx here to trigger import
    processed/  ← moved here on success
    failed/     ← moved here on parse/DB error
```
Create per-user folders before first use: `mkdir -p /opt/iris/gpx/<id>/inbox`
