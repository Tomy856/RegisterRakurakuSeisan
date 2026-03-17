@echo off
cd /d %~dp0
echo ========================================
echo   楽々申請ツール セットアップ
echo ========================================
echo.
echo Node.js のバージョン確認...
node --version
if %ERRORLEVEL% neq 0 (
    echo × Node.js がインストールされていません。
    echo   https://nodejs.org/ からインストールしてください。
    pause
    exit /b 1
)
echo.
echo npm パッケージをインストール中...
npm install
echo.
echo Playwright ブラウザをインストール中...
npx playwright install chromium
echo.
echo ========================================
echo [完了] セットアップ完了！
echo 次に Chrome起動.bat を実行してください。
echo ========================================
pause
