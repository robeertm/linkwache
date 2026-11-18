// Secrets in a link's query: stripped before outside services, shortened for display (src/redact.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSecretParam, stripSecrets, maskSecrets } from "../src/redact.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: "1234567890" }), "ZHVtbXktc2lnbmF0dXJlLWZvci10ZXN0cw"].join(".");   // a dummy, built at runtime (leak scan)

test("names and values that are secrets", () => {
  for (const n of ["jwt", "token", "access_token", "id_token", "sig", "Signature", "X-Amz-Signature", "X-Amz-Credential", "X-Goog-Signature", "api_key", "apikey", "key", "secret", "password", "session", "code", "download_token", "upload-sig"]) {
    assert.ok(isSecretParam(n, "x"), n);
  }
  assert.ok(isSecretParam("d", JWT), "a JWT under any name");
  assert.ok(isSecretParam("x", "a8F3kQ9zP2mX7vB4nC6tR1yW5uE0iO3sD8gH"), "a long opaque value");
  for (const [n, v] of [["q", "hello world"], ["page", "2"], ["lang", "de"], ["utm_source", "newsletter"], ["id", "12345"], ["ref", "abcdefghijklmnopqrstuvwxyzabcdefghij"]]) {
    assert.ok(!isSecretParam(n, v), n + "=" + v);
  }
});

test("stripSecrets drops secret parameters and keeps the rest, unparseable input unchanged", () => {
  assert.equal(stripSecrets(`https://img.example.com/u/1.png?jwt=${JWT}`), "https://img.example.com/u/1.png");
  assert.equal(stripSecrets("https://a.example/x?q=1&token=abc&page=2"), "https://a.example/x?q=1&page=2");
  assert.equal(stripSecrets("https://a.example/x?q=1"), "https://a.example/x?q=1");
  assert.equal(stripSecrets("https://a.example/x"), "https://a.example/x");
  assert.equal(stripSecrets("not a url"), "not a url");
});

test("maskSecrets shows only the first characters of a secret, drops the fragment", () => {
  const m = maskSecrets(`https://img.example.com/u/1.png?jwt=${JWT}#frag`);
  assert.equal(m, "https://img.example.com/u/1.png?jwt=eyJh…");
  assert.ok(!m.includes(JWT.slice(10, 40)));
  assert.equal(maskSecrets("https://a.example/x?q=1&sig=0123456789&p=2"), "https://a.example/x?q=1&sig=0123…&p=2");
  assert.equal(maskSecrets("https://a.example/x?q=1"), "https://a.example/x?q=1");
  assert.equal(maskSecrets("https://a.example/x?q=1#t"), "https://a.example/x?q=1");
});
