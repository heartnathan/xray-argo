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

async function startScripts() {
  const arch = getSystemArchitecture();
  console.log(`Detected architecture: ${arch}`);
  
  try {
    console.log('Downloading Xray...');
    await downloadAndExtractXray(arch);
    
    console.log('Downloading cloudflared...');
    await downloadCloudflared(arch);
    
    console.log('Starting Xray...');
    exec(`nohup ${webPath} -c ${configPath} >/dev/null 2>&1 &`);
    
    let argoArgs = ARGO_AUTH.includes('{') || ARGO_AUTH.length > 100
      ? `tunnel --no-autoupdate run --token ${ARGO_AUTH}`
      : `tunnel --no-autoupdate --url http://localhost:${ARGO_PORT}`;
    
    console.log('Starting cloudflared...');
    exec(`nohup ${botPath} ${argoArgs} >/dev/null 2>&1 &`);
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