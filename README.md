# Node.js Argo Deployment

This project deploy a network proxy service using Cloudflare Argo Tunnels on PaaS platforms.

## Improvements
- **Optimized Docker**: Uses lightweight Alpine Linux.

## Environment Variables
- `UUID`: Your custom UUID for connection.
- `ARGO_AUTH`: Your Cloudflare Tunnel Token (Optional).
- `ARGO_DOMAIN`: Your Cloudflare Tunnel DOMAIN (Optional).
- `PORT`: Server listening port (Default: 3000).

## How to Run
1. Deploy the code to your favorite PaaS.
2. Set the Environment Variables.
3. The service will automatically start the core and the tunnel.