# Ruby Browser

Two parts:
- **Server** (`server.js`, `Dockerfile`, `package.json`): Puppeteer over WebSocket. Needs a host that runs Docker. GitHub Pages cannot run it.
- **Client** (`index.html`, `client.js`): static, hosted on GitHub Pages.

## 1. Host the server (pick one)
All of these deploy straight from the Dockerfile. In each, set `ACCESS_TOKEN` to a long random string (the server won't start without it).

- **Render**: New -> Web Service -> connect the repo -> Runtime: Docker. The free tier sleeps when idle, so the first connection is slow.
- **Fly.io**: `fly launch` in the repo folder, then `fly secrets set ACCESS_TOKEN=...` and `fly deploy`.
- **Koyeb**: Create Web Service -> GitHub repo -> Dockerfile builder.
- **Your own PC (no hosting)**: `npm install`, set `ACCESS_TOKEN` and `PUPPETEER_EXECUTABLE_PATH` (path to Chrome), run `node server.js`, then expose it with `cloudflared tunnel --url http://localhost:3000`. Use the `https://...trycloudflare.com` URL it prints.

Use the public https URL as the "Server URL" in the client. (Railway also works whenever it's back.)

## 2. Host the client (GitHub Pages)
1. Put `index.html` and `client.js` in a repo (root or `/docs`).
2. Settings -> Pages -> Deploy from branch -> `main` / root (or `/docs`).
3. Open `https://<you>.github.io/<repo>/`, paste the server URL and your token, Connect.

## Notes
- The token is sent in the WebSocket URL; use HTTPS/WSS only.
- `evaluate` runs arbitrary JS in the remote browser, so keep the token private.
