// Failure cases: an origin-form // path is read as a URL authority and throws a 500; an unknown
// double-slash path becomes a different host's root; HEAD or single-fetch data follows another rule.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createServer as createViteServer } from "vite";
import webConfig from "../vite.config.ts";
import { fakeApi, startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer;
const upstreamPaths: string[] = [];
const api = fakeApi((url, _res, req) => {
  upstreamPaths.push(req.url ?? "");
  if (url.pathname === "/api/site/articles") return { items: [], total: 0, page: 1, limit: 25, pageCount: 0 };
  if (url.pathname === "/api/site/sources" || url.pathname === "/api/site/categories") return { items: [] };
  if (url.pathname === "/api/site/topics") return { groups: [], topics: [] };
});

before(async () => { web = await startWebServer(api); });
after(() => web.stop());

function raw(path: string, method: "GET" | "HEAD") {
  return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: web.port, path, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

test("origin-form slashes keep the router's homepage and unknown-route semantics", async () => {
  for (const method of ["GET", "HEAD"] as const) {
    const home = await raw("/", method);
    assert.equal(home.status, 200, web.logs());
    for (const path of ["//", "////"]) {
      const res = await raw(path, method);
      assert.equal(res.status, 200, `${method} ${path}: ${web.logs()}`);
      assert.equal(res.headers["content-type"], home.headers["content-type"]);
      assert.match(res.headers["cache-control"] ?? "", /no-store/);
      if (method === "HEAD") assert.equal(res.body, "");
    }
    const filtered = await raw("//?category=uncategorized", method);
    assert.equal(filtered.status, 200, web.logs());
    assert.match(filtered.headers["cache-control"] ?? "", /no-store/);
    if (method === "HEAD") assert.equal(filtered.body, "");
    for (const path of ["/unknown-page", "//unknown-page", "//evil.invalid/unknown-page", "//unknown-page.data?token=private"]) {
      const res = await raw(path, method);
      assert.equal(res.status, 404, `${method} ${path}: ${web.logs()}`);
      assert.equal(res.headers["cache-control"], "private, no-store");
      if (method === "HEAD") assert.equal(res.body, "");
    }
  }
  assert.equal(web.logs(), "");
  assert.ok(upstreamPaths.every((path) => path.startsWith("/api/site/")));
});

test("development navigation removes route selection before forwarding article filters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agidawn-dev-request-"));
  const vite = await createViteServer({
    root, configFile: false, envDir: false, publicDir: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [webConfig.plugins?.[0], {
      name: "inspect-loader-target",
      configureServer(server) {
        server.middlewares.use((req, res) => {
          res.setHeader("X-Loader-Target", req.url!);
          // React Router's development adapter creates its request from originalUrl.
          res.setHeader("X-Loader-Original-Target", req.originalUrl!);
          res.end();
        });
      },
    }],
  });
  const server = createServer(vite.middlewares);
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const [method, target, expected] of [
      ["GET", "/_.data?sourceId=source-ui&_routes=routes%2Fhome", "/_.data?sourceId=source-ui"],
      ["HEAD", "/_.data?topic=mcp&_routes=routes%2Fhome", "/_.data?topic=mcp"],
      ["GET", "/_.data?q=tools&category=coding&topic=mcp&sourceId=source-ui&from=2026-10-01&to=2026-10-28&page=2&limit=50&_routes=root", "/_.data?q=tools&category=coding&topic=mcp&sourceId=source-ui&from=2026-10-01&to=2026-10-28&page=2&limit=50"],
      ["GET", "/_.data?unknown=value&_routes=routes%2Fhome", "/_.data?unknown=value"],
      ["GET", "/admin/sources.data?_routes=admin-layout", "/admin/sources.data?_routes=admin-layout"],
      ["GET", "/%61dmin.data?_routes=admin-layout", "/%61dmin.data?_routes=admin-layout"],
      ["POST", "/_.data?sourceId=source-ui&_routes=routes%2Fhome", "/_.data?sourceId=source-ui&_routes=routes%2Fhome"],
      ["GET", "/?sourceId=source-ui&_routes=routes%2Fhome", "/?sourceId=source-ui&_routes=routes%2Fhome"],
      ["GET", "/unknown%ZZ", "/unknown%ZZ"],
      ["POST", "/admin/%ZZ.data?_routes=admin-layout", "/admin/%ZZ.data?_routes=admin-layout"],
    ] as const) {
      const response = await fetch(origin + target, { method });
      assert.equal(response.status, 200, `${method} ${target}`);
      assert.equal(response.headers.get("X-Loader-Target"), expected, `${method} ${target}`);
      assert.equal(response.headers.get("X-Loader-Original-Target"), expected, `${method} ${target}`);
      await response.text();
    }
    const malformed = await fetch(origin + "/%ZZ.data?_routes=routes%2Fhome");
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get("Cache-Control") ?? "", /no-store/);
    await malformed.text();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await vite.close();
    await rm(root, { recursive: true, force: true });
  }
});
