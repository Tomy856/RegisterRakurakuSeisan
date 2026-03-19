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
			applicant    VARCHAR(100) NOT NULL COMMENT '申請者',
			doc_type     VARCHAR(20)  NOT NULL COMMENT '書類区分(領収書/請求書)',
			storage_type VARCHAR(20)  NOT NULL COMMENT '保存形式',
			docs_json    JSON         NOT NULL COMMENT '書類明細JSON',
			status       ENUM('pending','submitting','submitted','error') NOT NULL DEFAULT 'pending',
			error_msg    TEXT,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
	`); err != nil {
		return err
	}

	// 交通費精算
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS traffic_expenses (
			id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			project      VARCHAR(200) NOT NULL COMMENT 'プロジェクト',
			applicant    VARCHAR(100) NOT NULL COMMENT '申請者',
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
