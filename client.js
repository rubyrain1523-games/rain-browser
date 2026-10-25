// client.js - works in the browser (GitHub Pages) as an ES module
export class RubyBrowser {
  constructor(serverUrl, token) {
    const base = serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/$/, '');
    this.wsUrl = `${base}/?token=${encodeURIComponent(token)}`;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = () => reject(new Error('Could not connect (check URL / token)'));
      this.ws.onclose = (e) => {
        for (const { reject } of this.pending.values()) reject(new Error(`Closed: ${e.code} ${e.reason}`));
        this.pending.clear();
      };
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg);
      };
    });
  }

  send(action, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Timeout'));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, action, params }));
    });
  }

  goto(url, waitUntil = 'networkidle2') { return this.send('goto', { url, waitUntil }); }
  click(selector) { return this.send('click', { selector }); }
  type(selector, text, delay = 50) { return this.send('type', { selector, text, delay }); }
  scroll(y = '100vh') { return this.send('scroll', { y }); }
  waitForSelector(selector, timeout = 10000) { return this.send('waitForSelector', { selector, timeout }); }
  screenshot(fullPage = false) { return this.send('screenshot', { fullPage }).then((r) => r.image); }
  getMarkdown() { return this.send('get_markdown').then((r) => r.markdown); }
  evaluate(script) { return this.send('evaluate', { script }).then((r) => r.result); }
  close() { this.ws?.close(); }
}
