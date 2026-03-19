package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tomida-t/register-rakuraku/internal/db"
	"github.com/tomida-t/register-rakuraku/internal/handler"
)

func main() {
	database, err := db.Connect()
	if err != nil {
		log.Fatalf("DB接続失敗: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("マイグレーション失敗: %v", err)
	}

	handler.Init(database)

	r := gin.Default()
	r.LoadHTMLGlob("./web/templates/*")

	// 静的HTMLはそのまま配信（Ginのテンプレートエンジンを通さない）
	r.GET("/receipt/new", func(c *gin.Context) {
		http.ServeFile(c.Writer, c.Request, "./web/static/receipt.html")
	})
	r.GET("/traffic/new", func(c *gin.Context) {
		http.ServeFile(c.Writer, c.Request, "./web/static/traffic.html")
	})

	// テンプレートで返すページ
	r.GET("/", handler.IndexPage)
	r.GET("/receipt", handler.ReceiptListPage)
	r.GET("/traffic", handler.TrafficListPage)
	r.GET("/submit", handler.SubmitPage)

	// 領収書・請求書 API
	receipt := r.Group("/api/receipts")
	{
		receipt.POST("", handler.CreateReceipt)
		receipt.GET("", handler.ListReceipts)
		receipt.GET("/:id", handler.GetReceipt)
		receipt.DELETE("/:id", handler.DeleteReceipt)
		receipt.POST("/:id/submit", handler.SubmitReceiptToRakuraku)
	}

	// 交通費 API
	traffic := r.Group("/api/traffic")
	{
		traffic.POST("", handler.CreateTraffic)
		traffic.GET("", handler.ListTraffics)
		traffic.GET("/:id", handler.GetTraffic)
		traffic.DELETE("/:id", handler.DeleteTraffic)
		traffic.POST("/:id/submit", handler.SubmitTrafficToRakuraku)
	}

	log.Println("サーバー起動: http://localhost:8080")
	r.Run(":8080")
}
