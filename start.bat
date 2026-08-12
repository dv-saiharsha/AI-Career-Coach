@echo off
REM Zenith launcher, kept for double-clicking and existing muscle memory.
REM The real logic lives in scripts/run.mjs so it works on macOS and Linux too.
REM Equivalent to: npm run dev

cd /d "%~dp0"
call npm run dev
pause
