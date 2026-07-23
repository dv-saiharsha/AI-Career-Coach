@echo off
REM ── Zenith: start backend + frontend together ──────────────────────────
REM Double-click this file, or run  start.bat  from the repo root.
REM Two windows open: one for the API (port 8000), one for the web app (3000).
REM Close either window to stop that server.

echo Starting Zenith backend and frontend...

start "Zenith Backend (API :8000)" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"

start "Zenith Frontend (Web :3000)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo   Backend : http://localhost:8000   (docs at /docs)
echo   Frontend: http://localhost:3000
echo.
echo Two windows opened. Give them a few seconds, then open the frontend URL.
