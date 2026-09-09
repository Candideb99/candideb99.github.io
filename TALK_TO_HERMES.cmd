@echo off
cd /d "%~dp0"
title Khazendar - talk to Hermes
echo.
echo   Hermes, the local editor of Khazendar.
echo   Type what you want in plain words, in Arabic or English. Examples:
echo.
echo     check the newsroom and tell me if anything is broken
echo     publish two new stories now
echo     find a better picture for the Oman trade story
echo     add the Saudi central bank feed to the sources
echo.
echo   Type /exit to leave.
echo.
"%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe" chat
pause
