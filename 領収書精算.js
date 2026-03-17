/**
 * 領収書精算.js
 * 
 * 【前提】
 * 先に Chrome起動.bat でブラウザを起動・ログイン済みにしてから実行する。
 * ブラウザは --remote-debugging-port=19223 で起動されている必要がある。
 * 
 * 【処理フロー（マニュアル 6-3, 6-5, 3-7 に基づく）】
 * Step1: 領収書精算フォルダ内のPDFを「領収書/請求書」にアップロード
 * Step2: 経費精算の新規作成画面を開く
 * Step3: CSVから明細を読み込み、領収書を紐付けて1件ずつ入力・確定
 * Step4: 最後にブラウザに申請を委ねる（誤送信防止）
 * 
 * 【フォルダ構成】
 * D:\ClaudeDesktop\楽々申請\領収書\
 *   ├─ 領収書_20250110.pdf   ← 領収書PDFファイル
 *   ├─ 領収書_20250111.pdf
 *   └─ 領収書データ.csv     ← 明細データ
 * 
 * 【CSVフォーマット】
 * 日付,支払先,内訳コード,内訳名,金額,摘要,領収書ファイル名
 * ※内訳コード: 300=その他, 100=接待交際費, 200=機材購入費 など
 * ※領収書ファイル名: 同フォルダ内のPDFファイル名（拡張子含む）
 */

const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const RECEIPT_DIR = path.join(__dirname, '領収書精算');
const DEBUG_PORT = 19223;
const WAIT_AFTER_ACTION = 800;

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
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
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
            console.log('  ⚠ 部門選択肢が見つかりません。手動で選択してください（5秒待ちます）。');
            await wait(5000);
        }
    }
}

// ========== Step1: 領収書PDFをアップロード ==========

async function uploadReceiptPDFs(page, pdfFiles) {
    console.log('\n[Step1] 領収書PDFをアップロード...');
    console.log('  TOP画面の「領収書/請求書」をクリックします...');

    // TOPページに戻る
    const topUrl = page.url().replace(/\/[^\/]+$/, '/');
    await page.goto(topUrl.split('/sap')[0] + '/sapKotsuhiDenpyo/initializeView');
    await wait(2000);

    // TOP画面の「領収書/請求書」リンクをクリック
    const receiptTopBtn = page.locator('a:has-text("領収書/請求書"), a[href*="EbookFile"]').first();
    if (await receiptTopBtn.count() === 0) {
        console.log('  ⚠ 「領収書/請求書」ボタンが見つかりません。TOP画面から手動で開いてください。');
        return false;
    }
    await receiptTopBtn.click();
    await wait(2000);

    const uploadedNames = [];

    for (const pdfPath of pdfFiles) {
        const fileName = path.basename(pdfPath);
        console.log(`  アップロード中: ${fileName}`);

        // 「新規登録」をクリック
        const newRegBtn = page.locator('button:has-text("新規登録"), a:has-text("新規登録"), input[value="新規登録"]').first();
        if (await newRegBtn.count() === 0) {
            console.log(`  ⚠ 「新規登録」ボタンが見つかりません。スキップします: ${fileName}`);
            continue;
        }
        await newRegBtn.click();
        await wait(1500);

        // ファイルを選択（参照ボタン or input[type=file]）
        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(pdfPath);
            await wait(2000);
            console.log(`    ファイル選択完了: ${fileName}`);
        } else {
            console.log(`    ⚠ ファイル入力欄が見つかりません: ${fileName}`);
            continue;
        }

        // 書類区分: 領収書を選択
        const receiptRadio = page.locator('input[type="radio"][value*="receipt"], label:has-text("領収書") input').first();
        if (await receiptRadio.count() > 0) {
            await receiptRadio.check();
            await wait(300);
        }

        // 「確定」をクリック
        const confirmBtn = page.locator('button:has-text("確定"), input[value="確定"]').first();
        if (await confirmBtn.count() > 0) {
            await confirmBtn.click();
            await wait(2000);
            console.log(`    ✓ アップロード完了: ${fileName}`);
            uploadedNames.push(fileName);
        } else {
            console.log(`    ⚠ 確定ボタンが見つかりません: ${fileName}`);
        }
    }

    return uploadedNames;
}

// ========== Step2: 経費精算画面を開く ==========

async function openExpenseForm(page) {
    console.log('\n[Step2] 経費精算アイコンをクリック...');

    // TOP画面（申請・承認）に移動
    const expenseIcon = page.locator('a:has-text("経費精算"), img[alt*="経費精算"], [title*="経費精算"]').first();
    if (await expenseIcon.count() === 0) {
        console.log('  ⚠ 経費精算アイコンが見つかりません。');
        console.log('  TOP画面の「申請・承認」を開いてから再実行してください。');
        return false;
    }
    await expenseIcon.click();
    await wait(2000);
    await selectDepartment(page);
    console.log('  経費精算画面を開きました: ' + page.url());
    return true;
}

// ========== Step3: 明細入力（領収書紐付き） ==========

async function addExpenseRow(page, row) {
    // 明細追加ボタン
    const addBtn = page.locator('button:has-text("明細追加"), input[value="明細追加"], a:has-text("明細追加")').first();
    await addBtn.click();
    await wait(WAIT_AFTER_ACTION);

    // --- 日付 ---
    if (row['日付']) {
        const dateInput = page.locator('input[name*="date"], input[id*="date"]').last();
        if (await dateInput.count() > 0) {
            await dateInput.fill(row['日付']);
            await wait(300);
        }
    }

    // --- 内訳（虫眼鏡ボタン or テキスト入力） ---
    if (row['内訳コード'] || row['内訳名']) {
        // コード入力欄があればコードを入力
        const codeInput = page.locator('input[name*="code"], input[id*="naiwake"], input[placeholder*="内訳"]').last();
        if (await codeInput.count() > 0 && row['内訳コード']) {
            await codeInput.fill(row['内訳コード']);
            await codeInput.press('Tab');
            await wait(500);
        }
    }

    // --- 金額 ---
    if (row['金額']) {
        const amountInput = page.locator('input[name*="amount"], input[id*="amount"], input[name*="kingaku"]').last();
        if (await amountInput.count() > 0) {
            await amountInput.fill(row['金額']);
            await wait(300);
        }
    }

    // --- 摘要 ---
    if (row['摘要']) {
        const remarkInput = page.locator('input[name*="remark"], input[id*="remark"], textarea[name*="note"], input[name*="note"]').last();
        if (await remarkInput.count() > 0) {
            await remarkInput.fill(row['摘要']);
            await wait(300);
        }
    }

    // --- 領収書の紐付け（6-5の手順）---
    if (row['領収書ファイル名']) {
        console.log(`    領収書を紐付け中: ${row['領収書ファイル名']}`);
        // 「領収書/請求書」ボタンをクリック
        const receiptBtn = page.locator('button:has-text("領収書"), a:has-text("領収書/請求書"), input[value*="領収書"]').last();
        if (await receiptBtn.count() > 0) {
            await receiptBtn.click();
            await wait(1500);

            // アップロード済み領収書の一覧からファイル名で選択
            const receiptItem = page.locator(`text=${row['領収書ファイル名']}`).first();
            if (await receiptItem.count() > 0) {
                // チェックボックスにチェック
                const checkbox = receiptItem.locator('..').locator('input[type="checkbox"]').first();
                if (await checkbox.count() > 0) {
                    await checkbox.check();
                } else {
                    await receiptItem.click();
                }
                await wait(500);

                // 「次へ」をクリック
                const nextBtn = page.locator('button:has-text("次へ"), input[value="次へ"]').first();
                if (await nextBtn.count() > 0) {
                    await nextBtn.click();
                    await wait(1500);
                }

                // 「明細追加」をクリック（6-5手順5）
                const addDetailBtn = page.locator('button:has-text("明細追加"), input[value="明細追加"]').last();
                if (await addDetailBtn.count() > 0) {
                    await addDetailBtn.click();
                    await wait(1000);
                    console.log(`    ✓ 領収書紐付け完了: ${row['領収書ファイル名']}`);
                }
            } else {
                console.log(`    ⚠ 領収書「${row['領収書ファイル名']}」が一覧に見つかりません。`);
                // ウィンドウを閉じる
                const closeBtn = page.locator('button:has-text("閉じる"), input[value="閉じる"]').last();
                if (await closeBtn.count() > 0) await closeBtn.click();
                await wait(500);
            }
        }
    }

    // --- 確定ボタン ---
    const confirmBtn = page.locator('button:has-text("確定"), input[value="確定"]').last();
    if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await wait(WAIT_AFTER_ACTION);
        console.log(`    ✓ 明細確定: ${row['日付']} ${row['支払先']} ${row['金額']}円`);
    }
}

// ========== メイン処理 ==========

async function run() {
    console.log('========================================');
    console.log('  領収書精算（経費精算）開始');
    console.log('========================================');

    // CSVファイル読み込み
    if (!fs.existsSync(RECEIPT_DIR)) {
        console.error(`× 領収書精算フォルダが見つかりません: ${RECEIPT_DIR}`);
        process.exit(1);
    }

    const csvFiles = fs.readdirSync(RECEIPT_DIR)
        .filter(f => f.endsWith('.csv') && !f.startsWith('~'))
        .map(f => path.join(RECEIPT_DIR, f));

    if (csvFiles.length === 0) {
        console.error('× 領収書精算フォルダにCSVファイルがありません。');
        process.exit(1);
    }

    let allRows = [];
    for (const csvFile of csvFiles) {
        console.log(`CSVファイル読み込み: ${path.basename(csvFile)}`);
        const rows = parseCSV(csvFile);
        console.log(`  → ${rows.length}件の明細`);
        allRows = allRows.concat(rows);
    }

    if (allRows.length === 0) {
        console.error('× 有効な明細データがありません。');
        process.exit(1);
    }

    // PDFファイル一覧（参照用）
    const pdfFiles = fs.readdirSync(RECEIPT_DIR)
        .filter(f => f.endsWith('.pdf'))
        .map(f => path.join(RECEIPT_DIR, f));

    console.log(`\n明細: ${allRows.length}件 / PDF: ${pdfFiles.length}件`);

    // ブラウザ接続
    let browser, page;
    try {
        ({ browser, page } = await connectBrowser());
    } catch (e) {
        console.error('× ' + e.message);
        process.exit(1);
    }

    try {
        // ---- Step1: PDFアップロード ----
        if (pdfFiles.length > 0) {
            await uploadReceiptPDFs(page, pdfFiles);
        } else {
            console.log('\n[Step1] PDFファイルがないためアップロードをスキップします。');
        }

        // ---- Step2: 経費精算画面を開く ----
        // TOP画面に戻る
        console.log('\nTOP画面（申請・承認）に戻ります...');
        // ヘッダのロゴや「申請・承認」タブをクリック
        const topMenuBtn = page.locator('a:has-text("申請・承認"), a:has-text("TOP"), [class*="logo"] a').first();
        if (await topMenuBtn.count() > 0) {
            await topMenuBtn.click();
            await wait(2000);
        }

        const opened = await openExpenseForm(page);
        if (!opened) {
            process.exit(1);
        }

        // ---- Step3: ヘッダの支払先入力（CSVの最初の支払先を使用）----
        if (allRows[0] && allRows[0]['支払先']) {
            console.log('\n[Step3] ヘッダの支払先を入力...');
            const payeeInput = page.locator('input[name*="payee"], input[id*="payee"], input[placeholder*="支払先"]').first();
            if (await payeeInput.count() > 0) {
                await payeeInput.fill(allRows[0]['支払先']);
                await wait(300);
            }
        }

        // ---- Step4: 明細入力 ----
        console.log('\n[Step4] 明細入力開始...');
        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            console.log(`  (${i + 1}/${allRows.length}) ${row['日付']} ${row['支払先']} ${row['金額']}円`);
            await addExpenseRow(page, row);
        }

        // ---- 完了 ----
        console.log('');
        console.log('========================================');
        console.log('[完了] 全明細の入力が終わりました。');
        console.log('');
        console.log('ブラウザで内容を確認してから「申請」ボタンを押してください。');
        console.log('※ 自動申請はしません（誤送信防止）。');
        console.log('========================================');

    } catch (e) {
        console.error('\nエラーが発生しました: ' + e.message);
        console.error(e.stack);
        console.log('ブラウザで手動確認してください。');
    } finally {
        await browser.close();
    }
}

run().catch(e => {
    console.error('予期しないエラー:', e.message);
    process.exit(1);
});
