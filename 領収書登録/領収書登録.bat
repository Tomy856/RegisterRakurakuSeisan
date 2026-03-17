@echo off
chcp 65001 > nul
cd /d %~dp0..\

rem 依存パッケージの確認
node -e "require('exceljs')" 2>nul
if %ERRORLEVEL% neq 0 (
    echo [Info] exceljs をインストールしています...
    npm install
    echo.
)

cd /d %~dp0
echo [Info] 領収書登録リストの更新を開始します...
node 領収書登録.js
pause
exit