package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

var database *sql.DB

func Init(db *sql.DB) {
	database = db
}

// ページ
func IndexPage(c *gin.Context)   { c.HTML(http.StatusOK, "index.html", nil) }
func ReceiptListPage(c *gin.Context) { c.HTML(http.StatusOK, "receipt_list.html", nil) }
func ReceiptNewPage(c *gin.Context)  { c.HTML(http.StatusOK, "receipt.html", nil) }
func TrafficListPage(c *gin.Context) { c.HTML(http.StatusOK, "traffic_list.html", nil) }
func TrafficNewPage(c *gin.Context)  { c.HTML(http.StatusOK, "traffic.html", nil) }
func SubmitPage(c *gin.Context)  { c.HTML(http.StatusOK, "submit.html", nil) }

// ---- 領収書・請求書 ----

type ReceiptRequest struct {
	Applicant   string      `json:"applicant"    binding:"required"`
	DocType     string      `json:"doc_type"     binding:"required"`
	StorageType string      `json:"storage_type" binding:"required"`
	Docs        interface{} `json:"docs"`
}

func CreateReceipt(c *gin.Context) {
	var req ReceiptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	docsJSON, _ := json.Marshal(req.Docs)
	res, err := database.Exec(
		`INSERT INTO receipts (applicant, doc_type, storage_type, docs_json) VALUES (?,?,?,?)`,
		req.Applicant, req.DocType, req.StorageType, string(docsJSON),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func ListReceipts(c *gin.Context) {
	rows, err := database.Query(
		`SELECT id, applicant, doc_type, storage_type, status, COALESCE(error_msg,''), created_at FROM receipts ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var list []gin.H
	for rows.Next() {
		var id uint64
		var applicant, docType, storageType, status, errMsg string
		var createdAt time.Time
		rows.Scan(&id, &applicant, &docType, &storageType, &status, &errMsg, &createdAt)
		list = append(list, gin.H{
			"id": id, "applicant": applicant, "doc_type": docType,
			"storage_type": storageType, "status": status,
			"error_msg": errMsg, "created_at": createdAt,
		})
	}
	if list == nil {
		list = []gin.H{}
	}
	c.JSON(http.StatusOK, list)
}

func GetReceipt(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var applicant, docType, storageType, status, errMsg string
	var createdAt time.Time
	err := database.QueryRow(
		`SELECT applicant, doc_type, storage_type, status, COALESCE(error_msg,''), created_at FROM receipts WHERE id=?`, id,
	).Scan(&applicant, &docType, &storageType, &status, &errMsg, &createdAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": id, "applicant": applicant, "doc_type": docType,
		"storage_type": storageType, "status": status,
		"error_msg": errMsg, "created_at": createdAt,
	})
}

func DeleteReceipt(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	database.Exec(`DELETE FROM receipts WHERE id=?`, id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func SubmitReceiptToRakuraku(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	database.Exec(`UPDATE receipts SET status='submitting' WHERE id=?`, id)
	// TODO: chromedp による実際の自動操作
	go func() {
		// 仮: 3秒後にsubmittedにする（実装時にchromedpに差し替え）
		time.Sleep(3 * time.Second)
		database.Exec(`UPDATE receipts SET status='submitted' WHERE id=?`, id)
	}()
	c.JSON(http.StatusAccepted, gin.H{"message": "送信開始しました", "status": "submitting"})
}

// ---- 交通費精算 ----

type TrafficRequest struct {
	Project   string      `json:"project"   binding:"required"`
	Applicant string      `json:"applicant" binding:"required"`
	UserName  string      `json:"user_name"`
	Payment   string      `json:"payment"   binding:"required"`
	Remarks   string      `json:"remarks"`
	Details   interface{} `json:"details"`
}

func CreateTraffic(c *gin.Context) {
	var req TrafficRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	detailsJSON, _ := json.Marshal(req.Details)
	res, err := database.Exec(
		`INSERT INTO traffic_expenses (project, applicant, user_name, payment, remarks, details_json) VALUES (?,?,?,?,?,?)`,
		req.Project, req.Applicant, req.UserName, req.Payment, req.Remarks, string(detailsJSON),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func ListTraffics(c *gin.Context) {
	rows, err := database.Query(
		`SELECT id, project, applicant, payment, status, COALESCE(error_msg,''), created_at FROM traffic_expenses ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var list []gin.H
	for rows.Next() {
		var id uint64
		var project, applicant, payment, status, errMsg string
		var createdAt time.Time
		rows.Scan(&id, &project, &applicant, &payment, &status, &errMsg, &createdAt)
		list = append(list, gin.H{
			"id": id, "project": project, "applicant": applicant,
			"payment": payment, "status": status,
			"error_msg": errMsg, "created_at": createdAt,
		})
	}
	if list == nil {
		list = []gin.H{}
	}
	c.JSON(http.StatusOK, list)
}

func GetTraffic(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var project, applicant, payment, status, errMsg string
	var createdAt time.Time
	err := database.QueryRow(
		`SELECT project, applicant, payment, status, COALESCE(error_msg,''), created_at FROM traffic_expenses WHERE id=?`, id,
	).Scan(&project, &applicant, &payment, &status, &errMsg, &createdAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": id, "project": project, "applicant": applicant,
		"payment": payment, "status": status,
		"error_msg": errMsg, "created_at": createdAt,
	})
}

func DeleteTraffic(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	database.Exec(`DELETE FROM traffic_expenses WHERE id=?`, id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func SubmitTrafficToRakuraku(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	database.Exec(`UPDATE traffic_expenses SET status='submitting' WHERE id=?`, id)
	// TODO: chromedp による実際の自動操作
	go func() {
		time.Sleep(3 * time.Second)
		database.Exec(`UPDATE traffic_expenses SET status='submitted' WHERE id=?`, id)
	}()
	c.JSON(http.StatusAccepted, gin.H{"message": "送信開始しました", "status": "submitting"})
}
