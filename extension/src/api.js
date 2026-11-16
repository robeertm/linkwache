// One name for the WebExtension API in Chromium (chrome.*) and Firefox (browser.*).
export const api = globalThis.browser ?? globalThis.chrome;
export const isFirefox = typeof globalThis.browser !== "undefined" && typeof globalThis.chrome !== "undefined" && /Firefox/.test(globalThis.navigator?.userAgent || "");
