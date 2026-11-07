# Xray with Cloudflare Argo Tunnel

Deploy Xray (VLESS/VMess) with Cloudflare Argo Tunnels on PaaS platforms.

## Features
- **Xray Core**: Latest Xray (VLESS + VMess over WebSocket)
- **Cloudflare Argo Tunnel**: Secure tunneling via cloudflared
- **Official Binaries**: Downloads directly from GitHub releases (XTLS/Xray-core, cloudflare/cloudflared)
- **Multi-arch Support**: AMD64 and ARM64
- **Lightweight Docker**: Node.js 20 Alpine base image

## Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `UUID` | Connection UUID | `9afd1229-b893-40c1-84dd-51e7ce204913` |
| `ARGO_AUTH` | Cloudflare Tunnel Token (optional) | - |
| `ARGO_DOMAIN` | Cloudflare Tunnel Domain (optional) | - |
| `PORT` | Server listening port | `3000` |
| `FILE_PATH` | Temporary file storage path | `.tmp` |
| `XRAY_VERSION` | Xray version to download | `v26.10.31` |
| `CLOUDFLARED_VERSION` | cloudflared version to download | `2026.10.7` |

## How to Run

### Local Development
```bash
npm install
npm start
```

### Docker
```bash
docker build -t xray-argo .
docker run -d -p 3000:3000 -e UUID=your-uuid -e ARGO_AUTH=your-token xray-argo
```

### PaaS Deployment (Render, Heroku, Railway, etc.)
1. Deploy the repository to your PaaS platform
2. Set the environment variables
3. The service will automatically download binaries and start the tunnel

## Architecture
- **Port 3000**: Main HTTP server (health check), bound to `0.0.0.0`
- **Port 8001**: Xray VLESS TCP (with fallback to WebSocket)
- **Port 3002**: VLESS WebSocket (`/vless-argo`)
- **Port 3003**: VMess WebSocket (`/vmess-argo`)

## Health Checks (Kubernetes / Docker)
| Endpoint | Meaning |
|----------|---------|
| `GET /` | Liveness: returns `200 System Running` as soon as the HTTP server is up |
| `GET /health` | Readiness: `200 {"status":"ok"}` only after Xray + cloudflared started; otherwise `503` with the current error |

Recommended Kubernetes probes (replace `3000` if you change `PORT`):

```yaml
ports:
  - containerPort: 3000
livenessProbe:
  httpGet:
    path: /
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 30
```

Notes:
- The container listens on `0.0.0.0`, so IPv4 pod probes can connect.
- Startup failures no longer kill the process; the HTTP server stays up so you can read logs and `/health` instead of hitting a crash loop.
- Startup is retried up to 5 times with a 5s delay.

## Binaries Source
- Xray: https://github.com/XTLS/Xray-core/releases
- cloudflared: https://github.com/cloudflare/cloudflared/releases

## License
MIT