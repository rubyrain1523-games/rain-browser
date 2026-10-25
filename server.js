// server.js
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import puppeteer from 'puppeteer-core';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const VALID_TOKEN = process.env.ACCESS_TOKEN;
if (!VALID_TOKEN) {
  console.error('ACCESS_TOKEN env var is required. Refusing to start without auth.');
  process.exit(1);
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

app.get('/', (_, res) => res.send('Ruby Browser Server Ready. Connect via WebSocket.'));

// --- PUPPETEER ---
let browserPromise = null;
const launchBrowser = () => {
  if (browserPromise) return browserPromise;
  browserPromise = puppeteer
    .launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--window-size=1280,720'
      ]
    })
    .then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      console.log('Browser launched');
      return b;
    })
    .catch((e) => { browserPromise = null; throw e; });
  return browserPromise;
};

// Block navigation to local/internal addresses (basic SSRF guard)
const isBlockedUrl = (raw) => {
  let u;
  try { u = new URL(raw); } catch { return true; }
  if (!['http:', 'https:'].includes(u.protocol)) return true;
  const h = u.hostname;
  return (
    h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) ||
    h === '::1' || h === '[::1]'
  );
};

// --- COMMAND HANDLERS ---
const handlers = {
  async goto(page, { url, waitUntil = 'networkidle2' }) {
    if (isBlockedUrl(url)) throw new Error('URL not allowed');
    await page.goto(url, { waitUntil, timeout: 60000 });
    return { success: true, url: page.url() };
  },

  async click(page, { selector }) {
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    await page.click(selector);
    return { success: true };
  },

  async type(page, { selector, text, delay = 50 }) {
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    await page.type(selector, text, { delay });
    return { success: true };
  },

  async waitForSelector(page, { selector, timeout = 10000 }) {
    await page.waitForSelector(selector, { timeout });
    return { success: true };
  },

  async scroll(page, { x = 0, y = '100vh' }) {
    await page.evaluate(
      (x, y) => {
        const px = typeof y === 'string' && y.endsWith('vh')
          ? (parseFloat(y) / 100) * window.innerHeight
          : Number(y);
        window.scrollBy(x, px);
      },
      x, y
    );
    return { success: true };
  },

  async get_markdown(page) {
    const html = await page.content();
    const dom = new JSDOM(html, { url: page.url() });
    const article = new Readability(dom.window.document).parse();
    let md;
    if (article?.content) {
      md = `# ${article.title || ''}\n\n` + turndown.turndown(article.content);
    } else {
      // Fallback for non-article pages (search results, apps)
      const d2 = new JSDOM(html, { url: page.url() }).window.document;
      d2.querySelectorAll('script,style,nav,footer,svg,noscript').forEach((n) => n.remove());
      md = turndown.turndown(d2.body?.innerHTML || '');
    }
    return { markdown: md.slice(0, 50000) };
  },

  async screenshot(page, { fullPage = false, format = 'jpeg', quality = 70 }) {
    const opts = { fullPage, type: format };
    if (format === 'jpeg') opts.quality = quality;
    const buf = await page.screenshot(opts);
    return { image: `data:image/${format};base64,${Buffer.from(buf).toString('base64')}` };
  },

  async evaluate(page, { script }) {
    const result = await page.evaluate(script);
    return { result };
  }
};

// --- WEBSOCKET ---
wss.on('connection', async (ws, req) => {
  // Auth first, before launching anything
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get('token') !== VALID_TOKEN) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log('Client connected');
  let page;
  try {
    const browser = await launchBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    // Only block heavy media; keep CSS/images so screenshots look right
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      ['media', 'font'].includes(r.resourceType()) ? r.abort() : r.continue();
    });
  } catch (e) {
    ws.close(1011, 'Browser failed to start');
    return;
  }

  ws.on('message', async (msg) => {
    let cmd;
    try { cmd = JSON.parse(msg); }
    catch { return ws.send(JSON.stringify({ id: null, error: 'Invalid JSON' })); }

    const { id, action, params } = cmd;
    const handler = handlers[action];
    if (!handler) return ws.send(JSON.stringify({ id, error: `Unknown action: ${action}` }));

    try {
      const result = await handler(page, params || {});
      ws.send(JSON.stringify({ id, ...result }));
    } catch (err) {
      console.error(`${action}:`, err.message);
      ws.send(JSON.stringify({ id, error: err.message }));
    }
  });

  ws.on('close', () => page?.close().catch(() => {}));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on ${PORT}`));
