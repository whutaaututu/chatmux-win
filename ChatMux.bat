@echo off
cd /d "%~dp0"
start "" "%CD%\node_modules\.bin\electron.cmd" .
