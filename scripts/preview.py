"""Local-only static preview with anonymous website icon discovery.

The Chrome extension fetches sites directly with its host permissions. This
helper gives an HTTP preview the same discovery path without an external proxy.
"""
import argparse
import functools
import gzip
import ipaddress
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "/__perch/"


def public_url(value, homepage=False):
    """Limit the helper to public HTTP(S); never forward supplied credentials."""
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise ValueError("Invalid URL")
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise ValueError("Only public HTTP(S) URLs are supported")
    hostname = url.hostname.lower().rstrip(".")
    if not hostname or "." not in hostname or hostname.endswith((".local", ".localhost", ".internal")):
        raise ValueError("Local destinations are not supported by the preview helper")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise ValueError("Private addresses are not supported")
    port = url.port  # Also validates malformed port values.
    host = hostname.encode("idna").decode("ascii")
    netloc = host + (f":{port}" if port is not None else "")
    return urlunsplit((url.scheme, netloc, "/" if homepage else url.path or "/", "" if homepage else url.query, ""))


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return super().redirect_request(request, response, code, message, headers, public_url(new_url))


def fetch_resource(value, kind):
    url = public_url(value, homepage=kind == "html")
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml" if kind == "html" else "image/*",
        "Accept-Encoding": "identity",
    })
    # No cookie jar, authentication handler, or browser session is attached.
    with build_opener(PublicRedirects()).open(request, timeout=5) as response:
        final_url = public_url(response.geturl())
        mime = response.headers.get_content_type().lower()
        if kind == "html" and mime not in ("text/html", "application/xhtml+xml"):
            raise ValueError("Expected HTML")
        if kind == "image" and not (mime.startswith("image/") or mime == "application/octet-stream"):
            raise ValueError("Expected an image")
        encoding = (response.headers.get("Content-Encoding") or "identity").lower()
        if encoding not in ("identity", "gzip"):
            raise ValueError("Unsupported response encoding")
        stream = gzip.GzipFile(fileobj=response) if encoding == "gzip" else response
        limit = 512 * 1024 if kind == "html" else 256 * 1024
        content = bytearray()
        while len(content) <= limit:
            chunk = stream.read(min(8192, limit + 1 - len(content)))
            if not chunk:
                break
            content.extend(chunk)
            if kind == "html":
                end = re.search(br"</head\s*>", content, re.IGNORECASE)
                if end:
                    content = content[:end.end()]
                    break
                if len(content) >= limit:
                    content = content[:limit]
                    break
        if len(content) > limit:
            raise ValueError("Image is too large")
        if kind == "html":
            charset = response.headers.get_content_charset() or "utf-8"
            try:
                html = bytes(content).decode(charset, errors="replace")
            except LookupError:
                html = bytes(content).decode("utf-8", errors="replace")
            return {"html": html, "url": final_url}
        return bytes(content), mime


def local_request(headers, port):
    host = headers.get("Host", "")
    if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
        return False
    if headers.get("Sec-Fetch-Site", "") == "cross-site":
        return False
    origin = headers.get("Origin")
    return not origin or origin == f"http://{host}"


class PreviewHandler(SimpleHTTPRequestHandler):
    def json_response(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The browser may cancel a timed-out icon request.

    def do_GET(self):
        path = urlsplit(self.path)
        if not path.path.startswith(PREFIX):
            return super().do_GET()
        if not local_request(self.headers, self.server.server_port):
            return self.json_response({"error": "Local same-origin requests only"}, 403)
        if path.path == PREFIX + "status":
            return self.json_response({"service": "perch-icon-preview", "version": 1})
        if path.path not in (PREFIX + "metadata", PREFIX + "image"):
            return self.json_response({"error": "Not found"}, 404)
        value = parse_qs(path.query).get("url", [""])[0]
        try:
            if path.path.endswith("metadata"):
                return self.json_response(fetch_resource(value, "html"))
            content, mime = fetch_resource(value, "image")
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "private, max-age=86400")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            return
        except ValueError as error:
            self.json_response({"error": str(error)}, 400)
        except (HTTPError, URLError, TimeoutError, OSError):
            self.json_response({"error": "Website icon request failed"}, 502)

    def log_request(self, code="-", size="-"):
        # Do not log icon query strings or CDN tokens.
        self.log_message('"%s %s" %s %s', self.command, urlsplit(self.path).path, code, size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5173)
    arguments = parser.parse_args()
    handler = functools.partial(PreviewHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", arguments.port), handler) as server:
        print(f"Perch preview: http://127.0.0.1:{arguments.port}/index.html", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
