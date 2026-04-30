# Node.js Argo 部署工具

本項目旨在 PaaS 平台上透過 Cloudflare Argo 隧道部署網路代理服務。

## 更新日誌
- **移除哪吒探針**：已刪除所有與哪吒監控相關的程式碼與功能，保持系統精簡。
- **Docker 優化**：採用 Alpine Linux 3.20，確保最小的映像檔體積。

## 環境變數說明
- `UUID`：用於連接的唯一識別碼。
- `ARGO_AUTH`：Cloudflare 隧道 Token（若不填寫則使用臨時隧道）。
- `ARGO_DOMAIN`：Cloudflare 隧道DOMAIN（若不填寫則使用臨時隧道）。
- `PORT`：伺服器監聽埠號（預設 3000）。

## 部署步驟
1. 將程式碼上傳至您的 PaaS 平台（如 Render, Heroku）。
2. 設定上述環境變數。
3. 程式啟動後會自動下載核心組件並建立隧道。