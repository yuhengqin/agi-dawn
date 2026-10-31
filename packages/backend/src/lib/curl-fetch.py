"""One pinned HTTP hop, with a shared per-host cooldown across API/worker processes."""
import base64
from contextlib import closing
import fcntl
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

try:
    from curl_cffi import Curl, CurlError, CurlInfo, CurlOpt, ffi, lib
except ImportError:
    print(json.dumps({"error": "curl_cffi unavailable: install deploy/curl-cffi-requirements.txt"}), flush=True)
    sys.exit(2)


def fetch(request):
    target = urlsplit(request["url"])
    port = target.port or (443 if target.scheme == "https" else 80)
    host = target.hostname
    address = request["address"]
    if ":" in address:
        address = "[" + address + "]"
    if ":" in host:
        host = "[" + host + "]"
    body = bytearray()
    header_lines = []
    header_bytes = 0
    oversized = False
    headers_oversized = False

    def receive_body(data):
        nonlocal oversized
        body.extend(data[:max(0, request["maxBytes"] + 1 - len(body))])
        if len(body) > request["maxBytes"]:
            oversized = True
            return 0
        return len(data)

    def receive_header(data):
        nonlocal header_bytes, headers_oversized
        header_bytes += len(data)
        if header_bytes > request["maxHeaderBytes"]:
            headers_oversized = True
            return 0
        if data.startswith(b"HTTP/"):
            header_lines.clear()  # Discard the CONNECT response and interim headers.
        elif b":" in data:
            name, value = data.split(b":", 1)
            header_lines.append((name.decode("latin1").strip(), value.decode("latin1").strip()))
        return len(data)

    with closing(Curl()) as curl:
        if curl.impersonate("chrome152") != 0:
            raise RuntimeError("Chrome profile unavailable")
        curl.setopt(CurlOpt.URL, request["url"].encode())
        curl.setopt(CurlOpt.FOLLOWLOCATION, 0)
        curl.setopt(CurlOpt.TIMEOUT_MS, max(1, int(request["timeoutMs"])))
        curl.setopt(CurlOpt.PROXY, (request["proxy"] or "").encode())
        curl.setopt(CurlOpt.NOPROXY, b"")
        if request["proxy"]:
            curl.setopt(CurlOpt.HTTPPROXYTUNNEL, 1)
        connection = lib.curl_slist_append(ffi.NULL, f"{host}:{port}:{address}:{port}".encode())
        curl.setopt(CurlOpt.CONNECT_TO, connection)
        curl.setopt(CurlOpt.ACCEPT_ENCODING, b"")
        curl.setopt(CurlOpt.HTTPHEADER, [f"{name}: {value}".encode() for name, value in request["headers"].items()])
        curl.setopt(CurlOpt.HEADERFUNCTION, receive_header)
        curl.setopt(CurlOpt.WRITEFUNCTION, receive_body)
        if request["method"] == "HEAD":
            curl.setopt(CurlOpt.NOBODY, 1)
        try:
            try:
                curl.perform()
            except CurlError:
                if headers_oversized:
                    raise RuntimeError("Response headers too large")
                if not oversized:
                    raise
        finally:
            curl.setopt(CurlOpt.CONNECT_TO, ffi.NULL)
            lib.curl_slist_free_all(connection)
        return {"status": curl.getinfo(CurlInfo.RESPONSE_CODE), "headers": header_lines,
                "body": base64.b64encode(body).decode("ascii")}


def main():
    request = json.load(sys.stdin)
    directory = Path(request["stateDir"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    hostname = urlsplit(request["url"]).hostname
    filename = "".join(c if c.isalnum() or c in ".-" else "_" for c in hostname) + ".lock"
    with (directory / filename).open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        lock.seek(0)
        saved = lock.read().strip()
        time.sleep(max(0, (float(saved) if saved else 0) - time.time()))

        def cooldown(delay):
            lock.seek(0)
            lock.truncate()
            lock.write(str(time.time() + delay))
            lock.flush()

        interval = request["intervalMs"] / 1000
        # A killed/timed-out subprocess leaves a conservative cooldown for the next process.
        cooldown(interval + request["timeoutMs"] / 1000)
        try:
            print(json.dumps({"ready": True}), flush=True)
            result = fetch(request)
        finally:
            cooldown(interval)
        print(json.dumps(result), flush=True)


try:
    main()
except CurlError as error:
    print(json.dumps({"error": f"curl_cffi request failed (curl code {error.code})", "timeout": error.code == 28}), flush=True)
    sys.exit(1)
except Exception as error:
    print(json.dumps({"error": f"curl_cffi request failed ({type(error).__name__})"}), flush=True)
    sys.exit(1)
