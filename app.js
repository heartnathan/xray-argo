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
  const preview = len > 0 ? `${trimmed.slice(0, 15)}...${trimmed.slice(-10)}` : '(empty)';

  console.log('=== ARGO_AUTH Debug ===');
  console.log(`Raw length: ${len}`);
  console.log(`Trimmed length: ${trimmedLen}`);
  console.log(`Preview: ${preview}`);
  console.log(`Starts with eyJ: ${trimmed.startsWith('eyJ')}`);
  console.log(`Includes {: ${raw.includes('{')}`);
  console.log(`Length > 100: ${len > 100}`);

  // 嘗試 base64 解碼（Cloudflare token 格式）
  if (trimmed) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      console.log(`Base64 decoded: ${decoded.slice(0, 120)}${decoded.length > 120 ? '...' : ''}`);
      try {
        const creds = JSON.parse(decoded);
        console.log(`Decoded JSON keys: ${Object.keys(creds).join(', ')}`);
      } catch (_) {
        console.log('Decoded content is NOT valid JSON');
      }
    } catch (_) {
      console.log('Base64 decode failed');
    }
  }
  console.log('=========================');

  return { raw, trimmed };
}

// 服務狀態（供 /health 讀取）
const serviceStatus = { started: false, error: null };

try {
  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }
} catch (e) {
  console.error(`Warning: cannot create FILE_PATH (${FILE_PATH}): ${e.message}`);
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
    // 開啟 log 檔案
    const logFd = fs.openSync(logPath, 'a');
    const child = require('child_process').spawn(botPath, argoArgs.split(' '), {
      stdio: ['ignore', 'pipe', logFd],  // 使用檔案描述符而非 WriteStream
      detached: true
    });

    child.unref();

    let connected = false;
    let output = '';

    child.stdout.on('data', (data) => {
      const msg = data.toString();
      output += msg;
      console.log(`[cloudflared] ${msg.trim()}`);
      
      if (msg.includes('Connected to Cloudflare') || 
          msg.includes('Starting tunnel') ||
          msg.includes('Registered tunnel')) {
        connected = true;
      }
    });

    child.on('error', (err) => {
      fs.closeSync(logFd);
      reject(new Error(`cloudflared spawn error: ${err.message}`));
    });

    child.on('exit', (code) => {
      fs.closeSync(logFd);
      if (!connected && code !== 0) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        reject(new Error(`cloudflared exited with code ${code}. Log: ${logContent.slice(-500)}`));
      }
    });

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
    // 使用 debugArgoAuth 回傳的 trimmed，避免重複處理
    const { trimmed: authTrimmed } = debugArgoAuth();
    const isTokenMode = ARGO_AUTH.includes('{') || ARGO_AUTH.length > 100;
    
    if (isTokenMode) {
      // Token 模式 - Cloudflare token 是 base64 編碼的 JSON credentials
      // 支援兩種鍵名格式：
      //   新版：{"a":"accountTag","t":"tunnelID","s":"tunnelSecret"}
      //   舊版：{"AccountTag":...,"TunnelID":...,"TunnelSecret":...}
      let decoded;
      try {
        decoded = Buffer.from(authTrimmed, 'base64').toString('utf8');
      } catch (e) {
        throw new Error('ARGO_AUTH validation failed: not valid base64');
      }

      let creds;
      try {
        creds = JSON.parse(decoded);
      } catch (e) {
        throw new Error(`ARGO_AUTH validation failed: decoded token is not valid JSON (preview: ${decoded.slice(0, 120)})`);
      }

      // 取出各欄位（兼容短鍵 a/t/s 與長鍵）
      const accountTag = creds.a || creds.AccountTag;
      const tunnelID = creds.t || creds.TunnelID;
      const tunnelSecret = creds.s || creds.TunnelSecret;

      if (!accountTag || !tunnelID || !tunnelSecret) {
        throw new Error(`ARGO_AUTH validation failed: missing a/t/s (decoded keys: ${Object.keys(creds).join(', ')})`);
      }

      console.log(`Token parsed OK: accountTag=${String(accountTag).slice(0,8)}... tunnelID=${tunnelID}`);
      argoArgs = `tunnel --no-autoupdate run --token ${authTrimmed}`;
      console.log('Mode: Permanent Tunnel (Token - base64 credentials)');
    } else {
      // Quick Tunnel 模式
      argoArgs = `tunnel --no-autoupdate --url http://localhost:${ARGO_PORT}`;
      console.log('Mode: Quick Tunnel (TryCloudflare)');
    }
    
    console.log('Starting cloudflared...');
    await startCloudflared(argoArgs);
    serviceStatus.started = true;
    serviceStatus.error = null;
    console.log("Services started successfully.");
  } catch (e) {
    // 不退出進程，讓 HTTP 伺服器保持存活以回應健康檢查與提供日誌
    serviceStatus.error = e.message;
    console.error("Startup error:", e.message);
    throw e;
  }
}

// 啟動流程（含重試），避免暫時性網路/下載失敗直接卡死
async function boot() {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await startScripts();
      return;
    } catch (e) {
      serviceStatus.error = e.message;
      console.error(`Startup attempt ${attempt}/${maxAttempts} failed: ${e.message}`);
      if (attempt < maxAttempts) {
        console.log(`Retrying in 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  console.error('All startup attempts failed. HTTP server stays up; /health returns 503.');
}

app.get("/", (req, res) => res.send("System Running"));

// /health：只有核心服務真的啟動成功才回 200
app.get("/health", (req, res) => {
  if (serviceStatus.started) {
    res.status(200).json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'starting', error: serviceStatus.error });
  }
});

// 明確綁定 0.0.0.0，確保 K8s/docker 的 IPv4 probe 可連線
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is listening on 0.0.0.0:${PORT}`);
  generateConfig()
    .then(boot)
    .catch((e) => console.error('Boot error:', e.message));
});