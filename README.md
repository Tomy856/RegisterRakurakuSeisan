# 楽々清算 かんたん登録サーバー

Go + Gin + MySQL + chromedp で構築した、楽々清算への経費登録を自動化するサーバーです。

## 📁 ディレクトリ構造

```
register-rakuraku/
├── cmd/server/main.go          # エントリーポイント
├── internal/
│   ├── db/db.go                # DB接続・マイグレーション
│   ├── model/expense.go        # データモデル
│   ├── repository/expense.go  # DB操作
│   ├── handler/expense.go     # HTTPハンドラ
│   └── rakuraku/submitter.go  # 楽々清算自動操作
├── web/templates/index.html   # フロントエンド
├── go.mod
└── .env.example
```

## 🚀 セットアップ

### 1. .env ファイルを作成
```bash
cp .env.example .env
# .env を編集して楽々清算のURL・ログイン情報を入力
```

### 2. MySQL にデータベース作成
```sql
CREATE DATABASE rakuraku CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. 依存関係インストール & 起動
```bash
go mod tidy
go run ./cmd/server/main.go
```

ブラウザで http://localhost:8080 を開く

## ⚠️ 楽々清算のセレクタ修正

`internal/rakuraku/submitter.go` の `#username`, `#password`, `#title` などの
セレクタは実際の楽々清算の画面を確認して修正してください。

ブラウザの開発者ツール（F12）で各フォーム要素のIDやセレクタを確認できます。

## 📡 API

| メソッド | パス                        | 説明              |
|--------|----------------------------|-----------------|
| GET    | /api/expenses               | 一覧取得          |
| POST   | /api/expenses               | 経費作成          |
| GET    | /api/expenses/:id           | 詳細取得          |
| PUT    | /api/expenses/:id           | 更新             |
| DELETE | /api/expenses/:id           | 削除             |
| POST   | /api/expenses/:id/submit    | 楽々清算に反映     |
