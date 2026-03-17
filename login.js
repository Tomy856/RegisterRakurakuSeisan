/**
 * login.js
 *
 * 処理の流れ:
 * 1. .conf の URL をブラウザで開く
 * 2. ユーザーが画面で ID・パスワードを入力してログイン
 * 3. トップ画面への遷移を自動で検出
 * 4. 完了メッセージを表示して終了
 *    → その後 交通費精算.bat / 領収書精算.bat を実行できる
 */

const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

function loadConf() {
    const confPath = path.join(__dirname, '.conf');
    const lines = fs.readFileSync(confPath, 'utf8').split('\n');
    const conf = {};
    for (const line of lines) {
        const [key, ...rest] = line.split('=');
        if (key && rest.length) conf[key.trim()] = rest.join('=').trim();
    }
    return conf;
}

async function waitForPort(port, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const ok = await new Promise(resolve => {
            http.get(`http://127.0.0.1:${port}/json/version`, res => {
                resolve(res.statusCode === 200);
            }).on('error', () => resolve(false));
        });
        if (ok) return true;
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

async function run() {
    const conf = loadConf();
    const siteUrl = conf.URL || '';

    if (!siteUrl) {
        console.error('× .conf ファイルに URL を設定してください。');
        process.exit(1);
    }

    // ========== ブラウザ起動 ==========
    const chromiumPath = chromium.executablePath();
    console.log('');
    console.log('========================================');
    console.log('  楽楽精算 Chrome起動');
    console.log('========================================');
    console.log('ブラウザを起動中...');

    const child = spawn(chromiumPath, [
        '--remote-debugging-port=19223',
        '--no-first-run',
        '--no-default-browser-check',
        siteUrl
    ], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();

    // ポート待機
    const ready = await waitForPort(19223);
    if (!ready) {
        console.error('× ブラウザの起動がタイムアウトしました。');
        process.exit(1);
    }

    // CDP接続
    const wsJson = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:19223/json/version', res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
    });

    const browser = await chromium.connectOverCDP(wsJson.webSocketDebuggerUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0];

    // ========== ログイン画面の表示を待つ ==========
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    console.log('');
    console.log('ブラウザでログイン画面が開きました。');
    console.log('ID とパスワードを入力して「ログイン」ボタンを押してください。');
    console.log('');
    console.log('（トップ画面への遷移を自動で検出します...）');

    // ========== トップ画面への遷移を検出（最大3分待機）==========
    const loginUrl = page.url();
    const timeout = 3 * 60 * 1000; // 3分
    const start = Date.now();
    let loggedIn = false;

    while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 1000));
        const currentUrl = page.url();

        // URLがログイン画面から変わったらトップ遷移と判断
        if (currentUrl !== loginUrl && !currentUrl.includes('login') && !currentUrl.includes('Login')) {
            loggedIn = true;
            break;
        }

        // トップ画面の特徴的な要素（申請・承認メニュー）を検出
        const topMenu = await page.locator('text=申請・承認, text=交通費精算, text=経費精算').count().catch(() => 0);
        if (topMenu > 0) {
            loggedIn = true;
            break;
        }
    }

    await browser.close(); // Playwrightの接続を切断（ブラウザは残る）

    console.log('');
    if (loggedIn) {
        console.log('========================================');
        console.log('[OK] トップ画面への遷移を確認しました！');
        console.log('');
        console.log('次のコマンドを実行できます:');
        console.log('  交通費精算.bat');
        console.log('  領収書精算.bat');
        console.log('========================================');
    } else {
        console.log('========================================');
        console.log('[確認] 3分経過しました。');
        console.log('ブラウザでトップ画面が表示されていれば');
        console.log('そのまま 交通費精算.bat / 領収書精算.bat を実行してください。');
        console.log('========================================');
    }
}

run().catch(e => {
    console.error('エラー:', e.message);
    process.exit(1);
});
