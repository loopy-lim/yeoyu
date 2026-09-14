#!/usr/bin/env python3
"""Local device acceptance fixture; bind only to localhost and use adb reverse."""
import argparse
import base64
import json
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def payload(self, body, content_type="text/plain", status=200, attachment=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "fixture=gecko-only; Path=/; SameSite=Lax")
        if attachment:
            self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/auth":
            expected = "Basic " + base64.b64encode(b"fixture:browser").decode()
            if self.headers.get("Authorization") != expected:
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="Browser contract"')
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.payload(b"Authentication returned to Gecko successfully")
        elif self.path == "/popup":
            self.payload(b"""<meta name="viewport" content="width=device-width,initial-scale=1"><title>Popup contract</title><h1>Popup contract</h1><button style="font:24px sans-serif;padding:24px" onclick="window.close()">Close popup</button><script>
const report=(kind,value)=>fetch('/receipt',{method:'POST',body:JSON.stringify({kind,value})});
report('popup-child-opener',!!opener);if(opener)opener.postMessage('opener-preserved',location.origin);
window.addEventListener('message',event=>report('popup-child-message',event.data));document.body.append('opener='+!!opener)
</script>""", "text/html")
        elif self.path == "/download":
            self.payload(b"A download must retain its POST body", status=405)
        elif self.path == "/maturity-download":
            self.payload(b"yeoyu-browser-maturity-download\n", "text/plain", attachment="yeoyu-maturity.txt")
        elif self.path == "/maturity-slow-download":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(8 * 1024 * 1024))
            self.send_header("Content-Disposition", 'attachment; filename="yeoyu-slow.bin"')
            self.end_headers()
            try:
                for _ in range(128):
                    self.wfile.write(b"x" * 65536)
                    self.wfile.flush()
                    time.sleep(self.server.slow_download_delay)
            except (BrokenPipeError, ConnectionResetError):
                pass
        elif self.path == "/browser-contracts.html":
            self.payload((ROOT / "browser-contracts.html").read_bytes(), "text/html")
        else:
            super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/receipt":
            record = json.loads(body)
            with self.server.receipts.open("a") as stream:
                stream.write(json.dumps(record) + "\n")
            self.payload(b"ok")
        elif self.path == "/download" and body == b"token=body-only" and "fixture=gecko-only" in self.headers.get("Cookie", ""):
            self.payload(b"yeoyu-authenticated-post-response\n", "application/octet-stream", attachment="yeoyu-post-contract.txt")
        else:
            self.payload(b"Fixture contract failed", status=403)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--receipts", type=Path, default=Path("/tmp/yeoyu-browser-contracts.jsonl"))
    parser.add_argument("--slow-download-delay", type=float, default=0.15,
                        help="Seconds between 64 KiB chunks; use 1 for manual cancellation checks")
    args = parser.parse_args()
    if not 0.01 <= args.slow_download_delay <= 10:
        parser.error("slow-download-delay must be between 0.01 and 10 seconds")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.receipts = args.receipts
    server.slow_download_delay = args.slow_download_delay
    print(f"Fixture listening on 127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
