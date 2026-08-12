@echo off
REM Creates local env files from the committed templates.
REM
REM Never overwrites an existing file — an unconditional copy would destroy a
REM developer's real credentials the second time anyone ran it.
REM
REM Usage:  scripts\setup-env.bat   (or double-click)

setlocal enabledelayedexpansion
pushd "%~dp0.."

set /a created=0
set /a skipped=0

echo Setting up local environment files...
echo.

REM Next.js reads .env.local, so the frontend template is named to match.
call :link "frontend\.env.local.example" "frontend\.env.local"
call :link "backend\.env.example"        "backend\.env"

echo.
echo   created: !created!   skipped: !skipped!

if !created! gtr 0 (
  echo.
  echo Next: open each new file and fill in the real values. Both are gitignored.
  echo.
  echo   backend\.env         DB_URL, ANTHROPIC_API_KEY, SUPABASE_URL,
  echo                        SUPABASE_SECRET_API_KEY
  echo   frontend\.env.local  NEXT_PUBLIC_SUPABASE_URL,
  echo                        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  echo.
  echo Ask a teammate for shared dev credentials rather than creating a second
  echo Supabase project - the database is shared, and a second project will not
  echo have the schema.
)

popd
endlocal
exit /b 0

:link
if not exist %1 (
  echo   !  %~2 template missing
  exit /b 0
)
if exist %2 (
  echo   =  %~2 already exists, left untouched
  set /a skipped+=1
  exit /b 0
)
copy /y %1 %2 >nul
echo   +  %~2 created
set /a created+=1
exit /b 0
