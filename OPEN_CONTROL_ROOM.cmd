@echo off
cd /d "%~dp0"
title Khazendar Control Room
echo Starting the Khazendar control room at http://127.0.0.1:7777 ...
start "" "http://127.0.0.1:7777/"
node scripts\control-room.mjs
pause
