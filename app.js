const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const AdmZip = require('adm-zip');

// 環境變數設定
const FILE_PATH = process.env.FILE_PATH || '.tmp';   
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913'; 
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          
const ARGO_AUTH = process.env.ARGO_AUTH || '';              
const ARGO_PORT = 8001;            

// 官方釋出版本（可透過環境變數覆蓋）
const XRAY_VERSION = process.env.XRAY_VERSION || 'v26.10.31';
const CLOUDFLARED_VERSION = process.env.CLOUDFLARED_VERSION || '2026.10.7';

// === ARGO_AUTH 除錯輸出（啟動時立即顯示，遮蔽敏感部分）===
function debugArgoAuth() {
  const raw = process.env.ARGO_AUTH || '';
  const len = raw.length;
  const trimmed = raw.trim();
  const trimmedLen = trimmed.length;
  const parts = trimmed.split('.');
  const preview = len > 0 ? `${trimmed.slice(0, 15)}...${trimmed.slice(-10)}` : '(empty)';
  
  console.log('=== ARGO_AUTH Debug ===');
  console.log(`Raw length: ${len}`);
  console.log(`Trimmed length: ${trimmedLen}`);
  console.log(`Parts (split by .): ${parts.length}`);
  console.log(`Preview: ${preview}`);
  console.log(`Starts with eyJ: ${trimmed.startsWith('eyJ')}`);
  console.log(`Includes {: ${raw.includes('{')}`);
  console.log(`Length > 100: ${len > 100}`);
  console.log('=========================');
  
  return { raw, trimmed, parts };
}

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

function generateRandomName() {
  return Math.random().toString(36).substring(2, 8);
}

const webName = generateRandomName();
const botName = generateRandomName();
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let configPath = path.join(FILE_PATH, 'config.json');
const logPath = path.join(FILE_PATH, 'cloudflared.log');

// 生成 Xray 配置
async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { 
        port: ARGO_PORT, 
        protocol: 'vless', 
        settings: { clients: [{ id: UUID }], decryption: 'none', fallbacks: [{ path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }] }, 
        streamSettings: { network: 'tcp' } 
      },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "ws", wsSettings: { path: "/vless-argo" } } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } } }
    ],
    outbounds: [{ protocol: "freedom", tag: "direct" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getSystemArchitecture() {
  const arch = os.arch();
  return (arch === 'arm64' || arch === 'aarch64') ? 'arm64' : 'amd64';
}

async function downloadFile(fileName, fileUrl) {
  console.log(`Downloading from ${fileUrl}...`);
  const res = await axios({ method: 'get', url: fileUrl, responseType: 'stream', timeout: 120000 });
  res.data.pipe(fs.createWriteStream(fileName));
  return new Promise((resolve, reject) => {
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });
}

async function downloadAndExtractXray(arch) {
  const baseUrl = `https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}`;
  const fileName = arch === 'arm64' ? 'Xray-linux-arm64-v8a.zip' : 'Xray-linux-64.zip';
  const downloadUrl = `${baseUrl}/${fileName}`;
  const zipPath = path.join(FILE_PATH, `${webName}.zip`);
  
  await downloadFile(zipPath, downloadUrl);
  
  // 解壓縮並取出 xray 執行檔
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  const xrayEntry = zipEntries.find(entry => entry.entryName === 'xray');
  
  if (!xrayEntry) {
    throw new Error('xray binary not found in zip');
  }
  
  fs.writeFileSync(webPath, xrayEntry.getData());
  fs.chmodSync(webPath, 0o775);
  
  // 清理 zip 檔案
  fs.unlinkSync(zipPath);
}

async function downloadCloudflared(arch) {
  const baseUrl = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;
  const fileName = arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
  const downloadUrl = `${baseUrl}/${fileName}`;
  
  await downloadFile(botPath, downloadUrl);
  fs.chmodSync(botPath, 0o775);
}

// 啟動 cloudflared 並驗證連線
async function startCloudflared(argoArgs) {
  return new Promise((resolve, reject) => {
    // 將 stderr 寫入 log 檔案，方便除錯
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const child = require('child_process').spawn(botPath, argoArgs.split(' '), {
      stdio: ['ignore', 'pipe', logStream],
      detached: true
    });

    child.unref(); // 讓父進程退出不影響子進程

    let connected = false;
    let output = '';

    // 監控 stdout 判斷是否連線成功
    child.stdout.on('data', (data) => {
      const msg = data.toString();
      output += msg;
      console.log(`[cloudflared] ${msg.trim()}`);
      
      // 判斷連線成功的關鍵字
      if (msg.includes('Connected to Cloudflare') || 
          msg.includes('Starting tunnel') ||
          msg.includes('Registered tunnel')) {
        connected = true;
      }
    });

    child.on('error', (err) => {
      logStream.end();
      reject(new Error(`cloudflared spawn error: ${err.message}`));
    });

    child.on('exit', (code) => {
      logStream.end();
      if (!connected && code !== 0) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        reject(new Error(`cloudflared exited with code ${code}. Log: ${logContent.slice(-500)}`));
      }
    });

    // 等待最多 15 秒確認連線
    const timeout = setTimeout(() => {
      if (connected) {
        console.log('cloudflared connected to Cloudflare successfully');
        resolve();
      } else {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        console.error('cloudflared connection timeout. Recent log:');
        console.error(logContent.slice(-1000));
        reject(new Error('cloudflared failed to connect within 15s. Check ARGO_AUTH token and network.'));
      }
    }, 15000);

    // 如果提前連線成功，清除 timeout
    const checkInterval = setInterval(() => {
      if (connected) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });
}

async function startScripts() {
  // 除錯：顯示 ARGO_AUTH 實際內容
  const { trimmed, parts } = debugArgoAuth();
  
  const arch = getSystemArchitecture();
  console.log(`Detected architecture: ${arch}`);
  
  try {
    console.log('Downloading Xray...');
    await downloadAndExtractXray(arch);
    
    console.log('Downloading cloudflared...');
    await downloadCloudflared(arch);
    
    console.log('Starting Xray...');
    require('child_process').spawn(webPath, ['-c', configPath], {
      stdio: 'ignore',
      detached: true
    }).unref();
    
    // 準備 cloudflared 參數
    let argoArgs;
    // 使用 debugArgoAuth 回傳的 trimmed 和 parts，避免重複處理
    const { trimmed: authTrimmed, parts: authParts } = debugArgoAuth();
    const isTokenMode = ARGO_AUTH.includes('{') || ARGO_AUTH.length > 100;
    
    if (isTokenMode) {
      // Token 模式 - 直接用已計算的值驗證
      if (authParts.length !== 3) {
        console.error(`ARGO_AUTH validation failed: Invalid JWT format: expected 3 parts, got ${authParts.length}`);
        console.error('Expected: JWT token (eyJ...) from Cloudflare Dashboard');
        process.exit(1);
      }
      for (const part of authParts) {
        if (!/^[A-Za-z0-9_-]+$/.test(part)) {
          console.error('ARGO_AUTH validation failed: Invalid JWT character in token');
          process.exit(1);
        }
      }
      argoArgs = `tunnel --no-autoupdate run --token ${authTrimmed}`;
      console.log('Mode: Permanent Tunnel (Token)');
    } else {
      // Quick Tunnel 模式
      argoArgs = `tunnel --no-autoupdate --url http://localhost:${ARGO_PORT}`;
      console.log('Mode: Quick Tunnel (TryCloudflare)');
    }
    
    console.log('Starting cloudflared...');
    await startCloudflared(argoArgs);
    console.log("Services started successfully.");
  } catch (e) {
    console.error("Startup error:", e.message);
    process.exit(1);
  }
}

app.get("/", (req, res) => res.send("System Running"));

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
  generateConfig().then(startScripts);
});