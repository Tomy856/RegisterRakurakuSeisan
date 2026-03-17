/**
 * 交通費精算.js
 *
 * 【前提】
 * 先に Chrome起動.bat でブラウザを起動・ログイン済みにしてから実行する。
 *
 * 【処理の流れ】
 * 1. 交通費精算アイコンをクリック
 * 2. 明細追加エリアの「CSV」ボタンをクリック
 * 3. 交通費精算フォルダ内のCSVファイルをサイトに渡す（ファイル選択ダイアログ）
 * 4. 取り込み完了を待機
 * 5. ユーザーが「申請」ボタンを押すのを待つ
 * 6. 申請完了を検出したら申請内容を「申請済」フォルダに保存し、元CSVから行を削除
 *
 * 【CSVフォーマット（サイト準拠）】
 * 日付,訪問先(社名等),出発(駅・バス停等),到着(駅・バス停等),備考,金額
 * ※日付: yyyy/MM/dd形式
 * ※金額: 半角数字
 * ※Shift-JIS / UTF-8 BOM付き 両対応
 */

const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TRANSPORT_DIR = path.join(__dirname, '交通費精算');
const ARCHIVE_DIR   = path.join(__dirname, '交通費精算', '申請済');
const DEBUG_PORT = 19223;

// ========== ユーティリティ ==========

async function connectBrowser() {
    const wsRes = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${DEBUG_PORT}/json/version`, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body).webSocketDebuggerUrl); }
                catch (e) { reject(new Error('ブラウザに接続できません。先に Chrome起動.bat を実行してください。')); }
            });
        }).on('error', () => reject(new Error('ブラウザに接続できません。先に Chrome起動.bat を実行してください。')));
    });
    const browser = await chromium.connectOverCDP(wsRes);
    const context = browser.contexts()[0];
    const pages = context.pages();
    return { browser, page: pages[0] };
}

function parseCSV(filePath) {
    const buf = fs.readFileSync(filePath);
    let content;
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        content = buf.toString('utf8').replace(/^\uFEFF/, '');
    } else {
        try {
            const iconv = require('iconv-lite');
            content = iconv.decode(buf, 'Shift_JIS');
        } catch(e) {
            content = buf.toString('utf8');
        }
    }
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const row = {};
        headers.forEach((h, i) => row[h] = values[i] || '');
        return row;
    });
}

async function wait(ms) {
    await new Promise(r => setTimeout(r, ms));
}

// ========== 部門選択 ==========

async function selectDepartment(page) {
    await wait(1500);
    const deptWindow = page.locator('text=この申請に用いる部門を選択してください').first();
    if (await deptWindow.count() > 0) {
        console.log('  部門選択ウィンドウが表示されました。');
        const firstDept = page.locator('.modal li, .popup li, [class*="depart"] li, [class*="select"] li').first();
        if (await firstDept.count() > 0) {
            const deptName = await firstDept.textContent();
            console.log(`  部門「${deptName.trim()}」を選択します。`);
            await firstDept.click();
            await wait(1500);
        } else {
            console.log('  ⚠ 部門選択肢が見つかりません。手動で選択してください。');
            await wait(5000);
        }
    }
}

// ========== CSV取り込み ==========

async function importCSV(page, csvPath) {
    console.log(`\n[2] CSVボタンをクリック...`);

    const csvBtn = page.locator('a:has-text("CSV"), button:has-text("CSV"), input[value="CSV"]').first();
    if (await csvBtn.count() === 0) {
        throw new Error('CSVボタンが見つかりません。');
    }
    await csvBtn.click();
    await wait(1500);

    console.log(`  ファイルを選択中: ${path.basename(csvPath)}`);
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) {
        throw new Error('ファイル入力欄が見つかりません。');
    }
    await fileInput.setInputFiles(csvPath);
    await wait(2000);

    const importBtn = page.locator('button:has-text("取込"), input[value="取込"], button:has-text("読込"), input[value="読込"), button:has-text("確定"), input[value="確定"]').first();
    if (await importBtn.count() > 0) {
        await importBtn.click();
        await wait(2000);
        console.log('  ✓ CSV取り込み完了');
    } else {
        console.log('  ✓ ファイル選択完了（自動取込）');
    }
}

// ========== 申請済フォルダへ保存 ==========

function saveToArchive(allRows) {
    // 申請済フォルダがなければ作成
    if (!fs.existsSync(ARCHIVE_DIR)) {
        fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }

    // ファイル名: 交通費-YYYYMMDD-HHmmss.csv
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const archivePath = path.join(ARCHIVE_DIR, `交通費-${stamp}.csv`);

    // ヘッダ + 申請した行をShift-JISで保存
    const header = '日付,訪問先(社名等),出発(駅・バス停等),到着(駅・バス停等),備考,金額';
    const dataLines = allRows.map(row =>
        [
            row['日付']              || '',
            row['訪問先(社名等)']    || '',
            row['出発(駅・バス停等)'] || '',
            row['到着(駅・バス停等)'] || '',
            row['備考']              || '',
            row['金額']              || '',
        ].join(',')
    );
    const content = [header, ...dataLines].join('\n') + '\n';

    try {
        const iconv = require('iconv-lite');
        fs.writeFileSync(archivePath, iconv.encode(content, 'Shift_JIS'));
    } catch(e) {
        fs.writeFileSync(archivePath, content, 'utf8');
    }

    console.log(`  申請済保存: ${path.basename(archivePath)}`);
    return archivePath;
}

// ========== CSV書き戻し（処理済み行を削除）==========

function saveCSVWithoutRows(filePath, removedRows) {
    const buf = fs.readFileSync(filePath);
    let content;
    let isShiftJIS = false;
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        content = buf.toString('utf8').replace(/^\uFEFF/, '');
    } else {
        try {
            const iconv = require('iconv-lite');
            content = iconv.decode(buf, 'Shift_JIS');
            isShiftJIS = true;
        } catch(e) {
            content = buf.toString('utf8');
        }
    }

    const lines = content.split('\n');
    const headerLine = lines[0];
    const dataLines = lines.slice(1).filter(l => l.trim().length > 0);

    // 日付+出発+到着+金額で一致した行を削除
    const remaining = dataLines.filter(line => {
        const vals = line.split(',').map(v => v.trim());
        return !removedRows.some(row =>
            row['日付']               === (vals[0] || '') &&
            row['出発(駅・バス停等)']  === (vals[2] || '') &&
            row['到着(駅・バス停等)']  === (vals[3] || '') &&
            row['金額']               === (vals[5] || '')
        );
    });

    const newContent = [headerLine, ...remaining].join('\n') + '\n';

    if (isShiftJIS) {
        const iconv = require('iconv-lite');
        fs.writeFileSync(filePath, iconv.encode(newContent, 'Shift_JIS'));
    } else {
        fs.writeFileSync(filePath, newContent, 'utf8');
    }

    console.log(`  CSV更新: ${remaining.length}行残り / ${removedRows.length}行削除`);
}

// ========== 申請完了を待機 ==========

async function waitForSubmit(page) {
    console.log('');
    console.log('----------------------------------------');
    console.log('ブラウザで内容を確認して「申請」ボタンを押してください。');
    console.log('申請完了を自動で検出してCSVから処理済み行を削除します。');
    console.log('（最大5分待機）');
    console.log('----------------------------------------');

    const beforeUrl = page.url();
    const timeout = 5 * 60 * 1000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 1000));

        const currentUrl = page.url();
        if (currentUrl !== beforeUrl) {
            console.log('  ✓ 申請完了を検出しました（URL変化）。');
            return true;
        }

        const doneText = await page.locator(
            'text=申請しました, text=受付番号, text=申請が完了, text=伝票No'
        ).count().catch(() => 0);

        if (doneText > 0) {
            console.log('  ✓ 申請完了を検出しました（完了メッセージ）。');
            return true;
        }
    }

    console.log('  ⚠ 5分経過しましたが申請完了を検出できませんでした。');
    console.log('  CSVは変更しません。申請済みの場合は手動でCSVの行を削除してください。');
    return false;
}

// ========== メイン処理 ==========

async function run() {
    console.log('========================================');
    console.log('  交通費精算 開始');
    console.log('========================================');

    if (!fs.existsSync(TRANSPORT_DIR)) {
        console.error(`× 交通費精算フォルダが見つかりません: ${TRANSPORT_DIR}`);
        process.exit(1);
    }
    const csvFiles = fs.readdirSync(TRANSPORT_DIR)
        .filter(f => f.endsWith('.csv') && !f.startsWith('~'))
        .map(f => path.join(TRANSPORT_DIR, f));

    if (csvFiles.length === 0) {
        console.error('× 交通費精算フォルダにCSVファイルがありません。');
        console.log('  テンプレート: 交通費テンプレート.csv を参考に作成してください。');
        process.exit(1);
    }

    // 全CSVの行を事前に読み込んでおく（申請済保存・行削除に使う）
    let allRows = [];
    for (const csvFile of csvFiles) {
        const rows = parseCSV(csvFile);
        console.log(`CSVファイル: ${path.basename(csvFile)} → ${rows.length}件`);
        allRows = allRows.concat(rows);
    }
    if (allRows.length === 0) {
        console.error('× 有効な明細データがありません。');
        process.exit(1);
    }
    console.log(`合計 ${allRows.length}件を取り込みます。`);

    // ブラウザ接続
    let browser, page;
    try {
        ({ browser, page } = await connectBrowser());
    } catch (e) {
        console.error('× ' + e.message);
        process.exit(1);
    }

    try {
        // [1] 交通費精算アイコンをクリック
        console.log('\n[1] 交通費精算アイコンをクリック...');
        const transportIcon = page.locator('a:has-text("交通費精算"), img[alt*="交通費精算"], [title*="交通費精算"]').first();
        if (await transportIcon.count() === 0) {
            console.error('× 交通費精算のアイコンが見つかりません。');
            console.log('  ブラウザでTOP画面を開いてから再実行してください。');
            process.exit(1);
        }
        await transportIcon.click();
        await wait(2000);
        await selectDepartment(page);

        // [2] CSVを1ファイルずつ取り込む
        for (const csvFile of csvFiles) {
            console.log(`\nCSV取り込み: ${path.basename(csvFile)}`);
            await importCSV(page, csvFile);
        }

        // [3] 申請完了を待機
        const submitted = await waitForSubmit(page);
        if (submitted) {
            // [4] 申請済フォルダへ保存
            console.log('\n[4] 申請済フォルダへ保存中...');
            saveToArchive(allRows);

            // [5] 元CSVから処理済み行を削除
            console.log('\n[5] 処理済み行をCSVから削除中...');
            for (const csvFile of csvFiles) {
                saveCSVWithoutRows(csvFile, allRows);
            }

            console.log('');
            console.log('========================================');
            console.log('[完了] 申請完了 & CSV更新が完了しました！');
            console.log('========================================');
        } else {
            console.log('');
            console.log('========================================');
            console.log('[終了] CSVは変更していません。');
            console.log('========================================');
        }

    } catch (e) {
        console.error('\nエラーが発生しました: ' + e.message);
        console.log('ブラウザで手動確認してください。');
    } finally {
        await browser.close();
    }
}

run().catch(e => {
    console.error('予期しないエラー:', e.message);
    process.exit(1);
});
