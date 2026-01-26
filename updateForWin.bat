@echo off
setlocal

REM =================================================
REM  Extension 路徑 = 此 .bat 所在資料夾
REM =================================================
set EXT_PATH=%~dp0
set EXT_PATH=%EXT_PATH:~0,-1%

REM =================================================
REM  確認在 extension 根目錄
REM =================================================
if not exist "%EXT_PATH%\manifest.json" (
  echo [ERROR] 找不到 manifest.json
  echo 請在 extension 根目錄執行此檔案
  pause
  exit /b 1
)

REM =================================================
REM  更新程式碼
REM =================================================
git fetch
git reset --hard origin/main

REM =================================================
REM  關閉 Chrome（兩段式，避免背景復活）
REM =================================================
taskkill /IM chrome.exe >nul 2>&1
timeout /t 1 /nobreak >nul
taskkill /F /IM chrome.exe >nul 2>&1

REM =================================================
REM  啟動 Chrome 並重新載入 extension
REM =================================================
start "" chrome ^
  --load-extension="%EXT_PATH%"

endlocal