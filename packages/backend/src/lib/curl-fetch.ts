// The optional browser-profile transport performs one checked HTTP hop; redirects stay in guardedFetch.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";

interface CurlFetchOptions {
  method: string;
  headers: Headers;
  address: string;
  proxy: string | null;
  timeoutMs: number;
  maxBytes: number;
  maxHeaderBytes: number;
  intervalMs: number;
  signal: AbortSignal;
  onStart(): void;
}

export function curlFetch(url: URL, opts: CurlFetchOptions): Promise<Response> {
  opts.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(config.curlPython, ["-I", fileURLToPath(new URL("./curl-fetch.py", import.meta.url))], {
      stdio: ["pipe", "pipe", "pipe"], env: { LANG: "C.UTF-8" },
    });
    let pending = "", outputBytes = 0, settled = false;
    let result: { status: number; headers: [string, string][]; body: string } | undefined;
    let failure: Error | undefined;
    const limit = Math.ceil((opts.maxBytes + 1) * 4 / 3) + opts.maxHeaderBytes * 6 + 4096;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      opts.signal.removeEventListener("abort", aborted);
      if (error) { child.kill("SIGKILL"); reject(error); return; }
      try {
        if (!result) throw failure ?? new Error("curl_cffi did not return a response");
        const body = Buffer.from(result.body, "base64");
        if (body.length > opts.maxBytes + 1) throw new Error("Invalid curl_cffi response size");
        resolve(new Response(opts.method === "HEAD" || [204, 205, 304].includes(result.status) ? null : body, {
          status: result.status, headers: result.headers,
        }));
      } catch (error) { reject(error); }
    };
    const aborted = () => finish(opts.signal.reason);
    opts.signal.addEventListener("abort", aborted, { once: true });
    child.on("error", () => finish(new Error("curl_cffi unavailable: install deploy/curl-cffi-requirements.txt and check CURL_CFFI_PYTHON")));
    child.stdin.on("error", () => {});
    child.stderr.resume(); // Python exceptions can include a proxy URL; never forward them to logs.
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > limit) { finish(new Error("curl_cffi response too large")); return; }
      pending += chunk.toString("utf8");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.ready === true) opts.onStart();
          else if (message.error) failure = message.timeout
            ? new DOMException("The operation was aborted due to timeout", "TimeoutError") : new Error(String(message.error));
          else result = message;
        } catch { finish(new Error("Invalid curl_cffi response")); return; }
      }
    });
    child.on("close", code => finish(code === 0 ? undefined : failure ?? new Error("curl_cffi request failed")));
    child.stdin.end(JSON.stringify({
      url: url.toString(), method: opts.method, headers: Object.fromEntries(opts.headers), address: opts.address,
      proxy: opts.proxy, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes, maxHeaderBytes: opts.maxHeaderBytes,
      intervalMs: opts.intervalMs, stateDir: path.join(config.dataDir, "curl-fetch"),
    }));
  });
}
