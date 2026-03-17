/**
 * 領収書登録.js
 *
 * 処理内容:
 * 1. 同一フォルダ内の「領収書登録.bat」「領収書登録.js」「領収書登録リスト.xlsx」以外のファイルを取得
 * 2. 領収書登録リスト.xlsx の C列（3列目）を読み込み、既に登録済みのファイル（フルパス）を把握
 * 3. 未登録のファイルがあれば、新しい行として追加（または空のC列を埋める）
 *    - A列: 領収書 (デフォルト)
 *    - B列: スキャナ保存 (デフォルト)
 *    - C列: ファイルのフルパス
 */

const Module = require('module');
const path = require('path');
const fs = require('fs');

const PARENT_NM = path.join(__dirname, '..', 'node_modules');
if (fs.existsSync(PARENT_NM)) {
    Module.globalPaths.push(PARENT_NM);
}

const ExcelJS = require('exceljs');

const DIR = __dirname;
const XLSX_PATH = path.join(DIR, '領収書登録リスト.xlsx');
const IGNORE = new Set(['領収書登録.bat', '領収書登録.js', '領収書登録リスト.xlsx']);

async function run() {
    console.log('========================================');
    console.log('  領収書登録リスト 更新処理');
    console.log('========================================');

    // 1. 対象ファイルの抽出
    const allFiles = fs.readdirSync(DIR).filter(f => {
        if (IGNORE.has(f)) return false;
        try {
            return fs.statSync(path.join(DIR, f)).isFile();
        } catch (e) {
            return false;
        }
    });

    if (allFiles.length === 0) {
        console.log('\n対象となる新しいファイルは見つかりませんでした。');
        return;
    }

    // 2. Excelファイルの読み込み
    if (!fs.existsSync(XLSX_PATH)) {
        console.error(`\nエラー: 領収書登録リスト.xlsx が見つかりません: ${XLSX_PATH}`);
        process.exit(1);
    }
    
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(XLSX_PATH);

    const ws = wb.getWorksheet('領収書登録') || wb.worksheets[0];
    if (!ws) {
        console.error('\nエラー: 有効なワークシートが見つかりません。');
        process.exit(1);
    }

    // 3. 既登録ファイルの確認 (C列をユニークキーとして扱う)
    const registered = new Set();
    const emptyCRows = []; // Column C が空の既存行（Row 2以降）
    
    // 全ての行をチェック（空行も含めてある程度見るために rowCount ではなく実際の行番号を扱う）
    const maxRow = ws.actualRowCount + 10; // 少し余裕を持ってチェック
    for (let i = 2; i <= maxRow; i++) {
        const row = ws.getRow(i);
        const valC = row.getCell(3).value;
        const valA = row.getCell(1).value;
        const valB = row.getCell(2).value;

        if (valC) {
            registered.add(String(valC).trim());
        } else if (valA || valB || i <= ws.actualRowCount) {
            // Cは空だが、AやBが入っている、または既存データの範囲内なら「空きスロット」候補
            emptyCRows.push(i);
        }
    }
    
    console.log(`\n現在の登録済み件数: ${registered.size}件`);

    // 4. 新規ファイルの追記
    let addedCount = 0;
    for (const fileName of allFiles) {
        const fullPath = path.resolve(DIR, fileName);
        
        // 重複チェック
        if (registered.has(fullPath)) {
            continue;
        }

        let targetRow;
        if (emptyCRows.length > 0) {
            // 既存の空きスロットを埋める
            targetRow = ws.getRow(emptyCRows.shift());
        } else {
            // 新しい行を追加
            targetRow = ws.addRow([]);
        }

        // 値の設定
        targetRow.getCell(1).value = '領収書';
        targetRow.getCell(2).value = 'スキャナ保存';
        targetRow.getCell(3).value = fullPath;
        targetRow.getCell(4).value = '';

        // スタイルの適用
        const rowNum = targetRow.number;
        const bgArgb = rowNum % 2 === 0 ? 'FFEBF3FB' : 'FFFFFFFF';

        for (let col = 1; col <= 4; col++) {
            const cell = targetRow.getCell(col);
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: bgArgb }
            };
            cell.font = { name: 'Meiryo UI', size: 10 };
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            cell.border = {
                top:    { style: 'thin', color: { argb: 'FFB8CCE4' } },
                bottom: { style: 'thin', color: { argb: 'FFB8CCE4' } },
                left:   { style: 'thin', color: { argb: 'FFB8CCE4' } },
                right:  { style: 'thin', color: { argb: 'FFB8CCE4' } },
            };
        }
        targetRow.height = 22;

        registered.add(fullPath);
        addedCount++;
        console.log(`  追加: ${fileName}`);
    }

    // 5. 保存
    if (addedCount > 0) {
        await wb.xlsx.writeFile(XLSX_PATH);
        console.log(`\n成功: ${addedCount}件のファイルをリストに追加しました。`);
    } else {
        console.log('\n新規に追加するファイルはありませんでした。');
    }

    console.log('========================================');
}

run().catch(e => {
    console.error('\nエラーが発生しました:', e);
    process.exit(1);
});
