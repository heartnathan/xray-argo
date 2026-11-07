# Xray 搭配 Cloudflare Argo 隧道

在 PaaS 平台上部署 Xray (VLESS/VMess) 搭配 Cloudflare Argo 隧道。

## 功能特點
- **Xray 核心**：最新版 Xray (VLESS + VMess over WebSocket)
- **Cloudflare Argo 隧道**：透過 cloudflared 建立安全隧道
- **官方釋出檔**：直接從 GitHub Releases 下載 (XTLS/Xray-core, cloudflare/cloudflared)
- **多架構支援**：AMD64 和 ARM64
- **輕量化 Docker**：Node.js 20 Alpine 基礎映像

## 環境變數
| 變數 | 說明 | 預設值 |
|------|------|--------|
| `UUID` | 連線用 UUID | `9afd1229-b893-40c1-84dd-51e7ce204913` |
| `ARGO_AUTH` | Cloudflare 隧道 Token (選填) | - |
| `ARGO_DOMAIN` | Cloudflare 隧道域名 (選填) | - |
| `PORT` | 伺服器監聽埠號 | `3000` |
| `FILE_PATH` | 暫存檔案路徑 | `.tmp` |
| `XRAY_VERSION` | 要下載的 Xray 版本 | `v26.10.31` |
| `CLOUDFLARED_VERSION` | 要下載的 cloudflared 版本 | `2026.10.7` |

## 執行方式

### 本地開發
```bash
npm install
npm start
```

### Docker
```bash
docker build -t xray-argo .
docker run -d -p 3000:3000 -e UUID=your-uuid -e ARGO_AUTH=your-token xray-argo
```

### PaaS 部署 (Render, Heroku, Railway 等)
1. 將儲存庫部署到您的 PaaS 平台
2. 設定環境變數
3. 服務會自動下載二進制檔並啟動隧道

## 架構說明
- **埠號 3000**：主 HTTP 伺服器 (健康檢查)
- **埠號 8001**：Xray VLESS TCP (含 WebSocket 回落)
- **埠號 3002**：VLESS WebSocket (`/vless-argo`)
- **埠號 3003**：VMess WebSocket (`/vmess-argo`)

## 二進制檔來源
- Xray: https://github.com/XTLS/Xray-core/releases
- cloudflared: https://github.com/cloudflare/cloudflared/releases

## 授權條款
MIT