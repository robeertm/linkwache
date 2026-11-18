// Secrets inside a link's query string (signed download links, login tokens, API keys).
// Shared by the server (never hand them to outside services) and the extension (never show them in full).
// Only the query string is looked at: the fragment never leaves the device anyway, and the path stays as it is.

/** Query parameter names that carry credentials or signatures (compared in lower case). */
const NAMES = new Set([
  "jwt", "token", "access_token", "id_token", "refresh_token", "auth", "authorization", "auth_token", "authtoken",
  "sig", "signature", "key", "api_key", "apikey", "secret", "client_secret", "password", "passwd", "pwd", "pass",
  "session", "sessionid", "session_id", "sid", "code", "ticket", "otp", "credential", "credentials", "hash", "hmac",
  "x-amz-signature", "x-amz-credential", "x-amz-security-token", "x-goog-signature", "x-goog-credential",
  "googleaccessid", "awsaccesskeyid", "policy", "skoid", "sktid", "st", "se", "sv", "sp", "sr",
]);
/** Name parts that mark a credential even in names not listed above (e.g. "download_token", "upload-sig"). */
const PARTS = /(^|[_\-.])(token|jwt|sig|signature|secret|password|apikey|credential)s?($|[_\-.])/i;
/** A JSON Web Token (three base64url parts, header starts with {" → eyJ). */
const JWT = /^eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*$/;
/** Long opaque values: 32+ characters of base64/base64url/hex without spaces. */
const OPAQUE = /^[A-Za-z0-9_\-+/=%.]{32,}$/;

/** Is this query parameter a secret (by its name or by the look of its value)? */
export function isSecretParam(name, value = "") {
  const n = String(name || "").toLowerCase();
  const v = String(value || "");
  if (NAMES.has(n) || PARTS.test(n)) return true;
  return JWT.test(v) || (OPAQUE.test(v) && !/^[a-z]+$/i.test(v) && /\d/.test(v) && /[a-z]/i.test(v));
}

function parse(url) { try { return new URL(String(url)); } catch { return null; } }

/** Remove secret query parameters (for lookups at outside services). Unparseable input comes back unchanged. */
export function stripSecrets(url) {
  const u = parse(url);
  if (!u || !u.search) return String(url);
  const keep = [...u.searchParams].filter(([k, v]) => !isSecretParam(k, v));
  if (keep.length === [...u.searchParams].length) return u.href;
  u.search = keep.length ? new URLSearchParams(keep).toString() : "";
  return u.href;
}

/** Shorten secret values for display: "jwt=eyJhbGciOi…" → "jwt=eyJh…"; the fragment is dropped. */
export function maskSecrets(url, keep = 4) {
  const u = parse(url);
  if (!u) return String(url);
  u.hash = "";
  if (!u.search) return u.href;
  const parts = [];
  let changed = false;
  for (const [k, v] of u.searchParams) {
    if (isSecretParam(k, v) && v) { parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v.slice(0, keep)) + "…"); changed = true; }
    else parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  if (!changed) return u.href;
  return u.origin + u.pathname + "?" + parts.join("&");
}
