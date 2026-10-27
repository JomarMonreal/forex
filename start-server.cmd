@echo off
rem Starts the FX Compass dev server (http://localhost:3000), appending output to dev.log.
rem Launched hidden at Windows logon by "FX Compass.vbs" in the Startup folder.
cd /d "%~dp0"
echo. >> dev.log
echo ===== Started %date% %time% ===== >> dev.log
call "C:\nvm4w\nodejs\npm.cmd" run dev >> dev.log 2>&1
