package handler

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

var database *sql.DB

func Init(db *sql.DB) {
	database = db
}

// ページ
func IndexPage(c *gin.Context)      { c.HTML(http.StatusOK, "index.html", nil) }
func ReceiptListPage(c *gin.Context) { c.HTML(http.StatusOK, "receipt_list.html", nil) }
func TrafficListPage(c *gin.Context) { c.HTML(http.StatusOK, "traffic_list.html", nil) }
func SubmitPage(c *gin.Context)      { c.HTML(http.StatusOK, "submit.html", nil) }

// ---- 領収書・請求書 ----

// CreateReceipt multipart/form-data でPDF+JSONを受け取る
func CreateReceipt(c *gin.Context) {
	// multipart フォームを解析（最大32MB）
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "フォーム解析失敗: " + err.Error()})
		return
	}

	docType     := c.PostForm("doc_type")
	storageType := c.PostForm("storage_type")
	docsJSON    := c.PostForm("docs_json")

	if docType == "" || storageType == "" || docsJSON == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "必須項目が不足しています"})
		return
	}

	// PDFファイル
	var pdfData []byte
	var pdfName string
	file, header, err := c.Request.FormFile("pdf_file")
	if err == nil {
		defer file.Close()
		pdfData, err = io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "PDFの読み込み失敗"})
			return
		}
		pdfName = header.Filename
	}

	// Gemini API で PDF → MD 変換
	var mdText string
	if len(pdfData) > 0 {
		mdText, _ = convertPdfToMd(pdfData)
	}

	// DB保存
	res, err := database.Exec(
		`INSERT INTO receipts (doc_type, storage_type, docs_json, pdf_data, pdf_name, md_text) VALUES (?,?,?,?,?,?)`,
		docType, storageType, docsJSON, pdfData, pdfName, mdText,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id, "md_text": mdText})
}

// convertPdfToMd Gemini API で PDF を Markdown に変換
func convertPdfToMd(pdfData []byte) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY が設定されていません")
	}

	b64 := base64.StdEncoding.EncodeToString(pdfData)

	reqBody := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{
						"inline_data": map[string]string{
							"mime_type": "application/pdf",
							"data":      b64,
						},
					},
					{
						"text": "この領収書・請求書のPDFを読み取り、以下の項目をMarkdown形式で出力してください。\n\n" +
							"- 取引日\n- 受領日\n- 取引先名\n- 事業者登録番号（T+13桁）\n- 金額と通貨\n- 備考\n\n" +
							"読み取れない項目は「不明」と記載してください。",
					},
				},
			},
		},
	}

	body, _ := json.Marshal(reqBody)
	url := "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Candidates) > 0 && len(result.Candidates[0].Content.Parts) > 0 {
		return result.Candidates[0].Content.Parts[0].Text, nil
	}
	return "", fmt.Errorf("Gemini からの応答が空です")
}

func ListReceipts(c *gin.Context) {
	rows, err := database.Query(
		`SELECT id, doc_type, storage_type, status, COALESCE(pdf_name,''), COALESCE(md_text,''), COALESCE(error_msg,''), created_at FROM receipts ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var list []gin.H
	for rows.Next() {
		var id uint64
		var docType, storageType, status, pdfName, mdText, errMsg string
		var createdAt time.Time
		rows.Scan(&id, &docType, &storageType, &status, &pdfName, &mdText, &errMsg, &createdAt)
		list = append(list, gin.H{
			"id": id, "doc_type": docType, "storage_type": storageType,
			"status": status, "pdf_name": pdfName, "md_text": mdText,
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
	var docType, storageType, status, pdfName, mdText, errMsg string
	var createdAt time.Time
	err := database.QueryRow(
		`SELECT doc_type, storage_type, status, COALESCE(pdf_name,''), COALESCE(md_text,''), COALESCE(error_msg,''), created_at FROM receipts WHERE id=?`, id,
	).Scan(&docType, &storageType, &status, &pdfName, &mdText, &errMsg, &createdAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": id, "doc_type": docType, "storage_type": storageType,
		"status": status, "pdf_name": pdfName, "md_text": mdText,
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
	go func() {
		time.Sleep(3 * time.Second)
		database.Exec(`UPDATE receipts SET status='submitted' WHERE id=?`, id)
	}()
	c.JSON(http.StatusAccepted, gin.H{"message": "送信開始しました", "status": "submitting"})
}

// ---- 交通費精算 ----

type TrafficRequest struct {
	Project  string      `json:"project"   binding:"required"`
	UserName string      `json:"user_name"`
	Payment  string      `json:"payment"   binding:"required"`
	Remarks  string      `json:"remarks"`
	Details  interface{} `json:"details"`
}

func CreateTraffic(c *gin.Context) {
	var req TrafficRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	detailsJSON, _ := json.Marshal(req.Details)
	res, err := database.Exec(
		`INSERT INTO traffic_expenses (project, user_name, payment, remarks, details_json) VALUES (?,?,?,?,?)`,
		req.Project, req.UserName, req.Payment, req.Remarks, string(detailsJSON),
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
		`SELECT id, project, payment, status, COALESCE(error_msg,''), created_at FROM traffic_expenses ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var list []gin.H
	for rows.Next() {
		var id uint64
		var project, payment, status, errMsg string
		var createdAt time.Time
		rows.Scan(&id, &project, &payment, &status, &errMsg, &createdAt)
		list = append(list, gin.H{
			"id": id, "project": project,
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
	var project, payment, status, errMsg string
	var createdAt time.Time
	err := database.QueryRow(
		`SELECT project, payment, status, COALESCE(error_msg,''), created_at FROM traffic_expenses WHERE id=?`, id,
	).Scan(&project, &payment, &status, &errMsg, &createdAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": id, "project": project,
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
	go func() {
		time.Sleep(3 * time.Second)
		database.Exec(`UPDATE traffic_expenses SET status='submitted' WHERE id=?`, id)
	}()
	c.JSON(http.StatusAccepted, gin.H{"message": "送信開始しました", "status": "submitting"})
}
