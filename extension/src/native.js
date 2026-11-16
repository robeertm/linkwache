// Native messaging to the desktop app (host app.linkwache.desktop, docs/API.md). The app is optional:
// every call resolves to null when it is not installed or does not answer, and the caller falls back to the server.
import { api } from "./api.js";

const HOST = "app.linkwache.desktop";
let port = null, retryAt = 0, nextId = 1, info = null;
const pending = new Map();

function connect() {
  if (port) return port;
  if (Date.now() < retryAt) return null;
  try {
    port = api.runtime.connectNative(HOST);
    port.onMessage.addListener((m) => { const p = pending.get(m && m.id); if (p) { pending.delete(m.id); p(m); } else if (m && m.type === "hello") { const h = pending.get("hello"); if (h) { pending.delete("hello"); h(m); } } });
    port.onDisconnect.addListener(() => { port = null; info = null; retryAt = Date.now() + 60000; for (const p of pending.values()) p(null); pending.clear(); });
  } catch { port = null; retryAt = Date.now() + 60000; }
  return port;
}

function ask(msg, timeout = 7000, key) {
  return new Promise((resolve) => {
    const p = connect();
    if (!p) return resolve(null);
    const id = key || String(nextId++);
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeout);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    try { p.postMessage(key ? msg : { ...msg, id }); } catch { clearTimeout(timer); pending.delete(id); resolve(null); }
  });
}

export async function hello(version) {
  const m = await ask({ type: "hello", version }, 3000, "hello");
  info = m && m.type === "hello" ? m : null;
  return info;
}
export const appInfo = () => info;
export async function check(url, lang) {
  const m = await ask({ type: "check", url, lang });
  return m && m.type === "result" ? m : null;
}
export const notify = (msg) => ask(msg, 3000);
