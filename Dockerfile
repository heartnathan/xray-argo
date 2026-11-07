# 使用 Node.js Alpine 作為基礎映像
FROM node:20-alpine

WORKDIR /app

# 安裝必要的系統工具
RUN apk update && apk --no-cache add curl bash

# 複製 package.json 並安裝依賴（利用 Docker 快取）
COPY package*.json ./
RUN npm ci --only=production

# 複製應用程式碼
COPY . .

EXPOSE 3000

# 啟動應用
CMD ["node", "app.js"]