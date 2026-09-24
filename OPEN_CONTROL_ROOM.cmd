@echo off
cd /d "%~dp0"
title Khazendar Control Room
echo Starting the Khazendar control room; your browser opens at its address in a moment ...
rem The control room opens the browser itself, at the port it actually got (Windows reserves some ports).
set KHAZENDAR_OPEN_BROWSER=1
node scripts\control-room.mjs
pause
