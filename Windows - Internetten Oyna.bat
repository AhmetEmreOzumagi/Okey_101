@echo off
rem 101 Okey - internet linkiyle baslatir (herkes her agdan girer). Cift tiklamaniz yeterli.
title 101 Okey
cd /d "%~dp0"
set "MODE=link"

call :findnode
if not defined NODE goto nonode

:run
"%NODE%" baslat.js %MODE%
echo.
echo   Oyun kapandi. Bu pencereyi kapatabilirsiniz.
pause >nul
exit /b

:findnode
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
exit /b

:nonode
echo.
echo   Node.js bulunamadi. Oyunu acmak icin bir kere Node.js kurmak gerekiyor (ucretsiz).
echo.
where winget >nul 2>nul
if errorlevel 1 goto manual
choice /c EH /n /m "  Simdi otomatik kurulsun mu? [E = Evet / H = Hayir] "
if errorlevel 2 goto manual
winget install -e --id OpenJS.NodeJS.LTS
call :findnode
if defined NODE goto run
echo.
echo   Kurulum bitti. Bu pencereyi kapatip dosyaya tekrar cift tiklayin.
pause >nul
exit /b

:manual
echo   Acilan sayfadan "LTS" surumunu indirip kurun, sonra bu dosyaya tekrar cift tiklayin.
start "" "https://nodejs.org/"
pause >nul
exit /b
