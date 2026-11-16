#!/usr/bin/env python3
"""Stand-in Linkwache server for the emulator tests (docs/API.md, v1).

Verdict by host: rot.* -> red, gelb.* -> amber, everything else -> green.
Also serves a fake GitHub "latest release" for the updater test:
  /release/good   APK with the correct SHA-256 digest
  /release/badsha APK with a wrong digest
  /release/signer a differently signed APK with the correct digest
Every check request is appended to the request log (one JSON line).
Test domains only (.example, .test); never real scam addresses.
"""
import argparse, hashlib, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8787)
ap.add_argument("--log", default="requests.log")
ap.add_argument("--apk", default="")          # newer build of the app (same signer)
ap.add_argument("--foreign-apk", default="")  # other package / signer
ap.add_argument("--version", default="99.0.0")
args = ap.parse_args()


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(65536), b""):
            h.update(b)
    return h.hexdigest()


def verdict(url):
    host = (urlsplit(url).hostname or "").lower()
    base = {"api": 1, "rules": 2, "score": 0, "url": url, "host": {"host": host, "domain": host, "unicodeHost": host},
            "chain": [], "cacheTtl": 60, "checked": "2026-11-16T12:00:00.000Z", "server": "e2e"}
    if host.startswith("rot."):
        return {**base, "stufe": "rot", "score": 13, "kurzKey": "v.rot.one", "ratKey": "v.rot.rat",
                "findings": [{"key": "age-fresh", "stufe": "rot", "p": {"age": "2 days"}},
                             {"key": "tld", "stufe": "gelb", "p": {"tld": "example"}}]}
    if host.startswith("gelb."):
        return {**base, "stufe": "gelb", "score": 3, "kurzKey": "v.gelb.one", "ratKey": "v.gelb.one.rat",
                "findings": [{"key": "age-young", "stufe": "gelb", "p": {"age": 41}}]}
    return {**base, "stufe": "gruen", "kurzKey": "v.gruen", "ratKey": "v.gruen.rat", "findings": []}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = urlsplit(self.path).path
        if p == "/api/health":
            return self.send(200, {"ok": True, "version": "e2e", "api": [1]})
        if p.startswith("/release/"):
            mode = p.rsplit("/", 1)[1]
            name = f"Linkwache-android-{args.version}.apk"
            src = args.foreign_apk if mode == "signer" else args.apk
            if not src or not os.path.exists(src):
                return self.send(404, {"message": "Not Found"})
            digest = sha(src) if mode != "badsha" else "0" * 64
            host = self.headers.get("host")
            return self.send(200, {
                "tag_name": f"v{args.version}", "draft": False, "prerelease": False,
                "html_url": f"http://{host}/releases/v{args.version}",
                "assets": [{"name": name, "size": os.path.getsize(src), "digest": f"sha256:{digest}",
                            "browser_download_url": f"http://{host}/apk/{mode}/{name}"}],
            })
        if p.startswith("/apk/"):
            mode = p.split("/")[2]
            src = args.foreign_apk if mode == "signer" else args.apk
            with open(src, "rb") as f:
                return self.send(200, f.read(), "application/vnd.android.package-archive")
        return self.send(404, {"error": "notfound"})

    def do_POST(self):
        if urlsplit(self.path).path != "/api/v1/check":
            return self.send(404, {"error": "notfound"})
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        rec = {"url": body.get("url"), "lang": body.get("lang"), "scope": body.get("scope"),
               "install": self.headers.get("x-linkwache-install"), "client": self.headers.get("x-linkwache-client"),
               "origin": self.headers.get("origin")}
        with open(args.log, "a") as f:
            f.write(json.dumps(rec) + "\n")
        if len(rec["install"] or "") != 32:
            return self.send(400, {"error": "err.install"})
        return self.send(200, verdict(body.get("url") or ""))


ThreadingHTTPServer(("0.0.0.0", args.port), H).serve_forever()
