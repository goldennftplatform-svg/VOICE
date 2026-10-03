@echo off
cd /d "%~dp0"
if not exist node_modules\wrangler call npm ci
call npm run preview
pause
