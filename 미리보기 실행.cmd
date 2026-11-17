@echo off
cd /d "%~dp0"
node tools/public-jobs/open-preview.mjs
if errorlevel 1 pause
