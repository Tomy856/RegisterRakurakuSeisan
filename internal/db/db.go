package db

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/go-sql-driver/mysql"
)

func Connect() (*sql.DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=Asia%%2FTokyo",
		getenv("DB_USER", "root"),
		getenv("DB_PASSWORD", "password"),
		getenv("DB_HOST", "localhost"),
		getenv("DB_PORT", "3306"),
		getenv("DB_NAME", "rakuraku"),
	)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	// 領収書・請求書
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS receipts (
			id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			doc_type     VARCHAR(20)   NOT NULL COMMENT '書類区分(領収書/請求書)',
			storage_type VARCHAR(20)   NOT NULL COMMENT '保存形式',
			docs_json    JSON          NOT NULL COMMENT '書類明細JSON',
			pdf_data     LONGBLOB               COMMENT 'PDFバイナリ',
			pdf_name     VARCHAR(255)           COMMENT 'PDFファイル名',
			md_text      MEDIUMTEXT             COMMENT 'AI読み取り結果MD',
			status       ENUM('pending','submitting','submitted','error') NOT NULL DEFAULT 'pending',
			error_msg    TEXT,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
	`); err != nil {
		return err
	}

	// 既存テーブルへのカラム追加（既にある場合はスキップ）
	cols := []struct{ col, def string }{
		{"pdf_data", "LONGBLOB COMMENT 'PDFバイナリ'"},
		{"pdf_name", "VARCHAR(255) COMMENT 'PDFファイル名'"},
		{"md_text",  "MEDIUMTEXT COMMENT 'AI読み取り結果MD'"},
	}
	for _, c := range cols {
		db.Exec(`ALTER TABLE receipts ADD COLUMN ` + c.col + ` ` + c.def)
	}

	// 交通費精算
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS traffic_expenses (
			id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			project      VARCHAR(200) NOT NULL COMMENT 'プロジェクト',
			user_name    VARCHAR(100) NOT NULL DEFAULT '' COMMENT '利用者(代理申請)',
			payment      VARCHAR(50)  NOT NULL COMMENT '支払い方法',
			remarks      TEXT         NOT NULL COMMENT '備考',
			details_json JSON         NOT NULL COMMENT '明細JSON',
			status       ENUM('pending','submitting','submitted','error') NOT NULL DEFAULT 'pending',
			error_msg    TEXT,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
	`); err != nil {
		return err
	}

	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
