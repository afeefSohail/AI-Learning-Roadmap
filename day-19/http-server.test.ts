import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { after, before, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startMockApi } from "../day-17/mock-api";
import { configFromEnv, startHttpServer } from "./http-server";

const portOf = (s: Server) => (s.address() as { port: number }).port;
const stop = (s: Server) => {
  s.closeAllConnections(); // do not wait for idle keep-alive connections
  s.close();
};

/** A raw request, so the test can set the Host and Origin headers (fetch does not let it). */
function raw(port: number, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("configuration", () => {
  test("defaults: loopback only, port 3333", () => {
    assert.deepEqual(configFromEnv({}), { port: 3333, host: "127.0.0.1", allowedHosts: ["localhost", "127.0.0.1", "[::1]"] });
  });
  test("ALLOWED_HOSTS adds names and never removes the loopback ones the health check needs", () => {
    const cfg = configFromEnv({ HOST: "0.0.0.0", PORT: "4000", ALLOWED_HOSTS: " mcp , mcp.example.com ,," });
    assert.equal(cfg.host, "0.0.0.0");
    assert.equal(cfg.port, 4000);
    assert.deepEqual(cfg.allowedHosts, ["localhost", "127.0.0.1", "[::1]", "mcp", "mcp.example.com"]);
  });
});

describe("binding", () => {
  test("listens on 127.0.0.1 by default, and on every interface only when HOST says so", async () => {
    const local = await startHttpServer({ port: 0 });
    const open = await startHttpServer({ port: 0, host: "0.0.0.0" });
    try {
      assert.equal((local.address() as { address: string }).address, "127.0.0.1");
      assert.equal((open.address() as { address: string }).address, "0.0.0.0");
    } finally {
      stop(local); // a failed assertion must not leave a server open
      stop(open);
    }
  });
});

describe("host and origin checks", () => {
  let server: Server;
  before(async () => {
    server = await startHttpServer({ port: 0, allowedHosts: ["localhost", "127.0.0.1", "mcp"] });
  });
  after(() => stop(server));

  test("/health answers without a token", async () => {
    const r = await raw(portOf(server), "/health", { Host: "127.0.0.1" });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { status: "ok" });
  });

  test("a Host header that is not allowed is rejected with 403, on /mcp and on /health", async () => {
    for (const path of ["/health", "/mcp"]) {
      const r = await raw(portOf(server), path, { Host: "evil.example" });
      assert.equal(r.status, 403, path);
    }
  });

  test("a configured service name is accepted, with or without a port", async () => {
    assert.equal((await raw(portOf(server), "/health", { Host: "mcp:3333" })).status, 200);
    assert.equal((await raw(portOf(server), "/health", { Host: "mcp" })).status, 200);
  });

  test("the same service name is rejected when it is not configured", async () => {
    const strict = await startHttpServer({ port: 0 });
    assert.equal((await raw(portOf(strict), "/health", { Host: "mcp:3333" })).status, 403);
    stop(strict);
  });

  test("a browser request from another site is rejected, one without Origin or from localhost is not", async () => {
    const port = portOf(server);
    assert.equal((await raw(port, "/health", { Host: "localhost", Origin: "http://evil.example" })).status, 403);
    assert.equal((await raw(port, "/health", { Host: "localhost", Origin: "http://localhost:6274" })).status, 200);
    assert.equal((await raw(port, "/health", { Host: "localhost" })).status, 200);
  });

  test("other paths are 404", async () => {
    assert.equal((await raw(portOf(server), "/", { Host: "localhost" })).status, 404);
  });
});

describe("addresses inside and outside Docker", () => {
  let api: Awaited<ReturnType<typeof startMockApi>>;
  let server: Server;
  before(async () => {
    api = await startMockApi();
    process.env.USERAUTH_BASE_URL = api.url; // what the MCP server uses (in Docker: http://user-auth:3000)
    process.env.PUBLIC_BASE_URL = "http://localhost:3000"; // what the user's machine can open
    server = await startHttpServer({ port: 0 });
  });
  after(() => {
    delete process.env.PUBLIC_BASE_URL;
    stop(server);
    stop(api.server);
  });

  test("photo links use PUBLIC_BASE_URL, and the API is still called at USERAUTH_BASE_URL", async () => {
    const client = new Client({ name: "t", version: "1" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portOf(server)}/mcp`), { requestInit: { headers: { Authorization: "Bearer token-a" } } }),
    );
    const list = await client.callTool({ name: "list_photos", arguments: {} });
    const photos = JSON.parse((list.content as Array<{ text: string }>)[0]!.text) as Array<{ url: string }>;
    assert.ok(photos.length > 0);
    for (const p of photos) assert.ok(p.url.startsWith("http://localhost:3000/uploads/"), p.url);
    const me = JSON.parse((((await client.callTool({ name: "get_me", arguments: {} })).content) as Array<{ text: string }>)[0]!.text);
    for (const p of me.photos) assert.ok(p.url.startsWith("http://localhost:3000/uploads/"), p.url);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["delete_photo", "get_me", "get_photo", "list_photos", "update_profile"]);
    await client.close();
  });
});

describe("stopping", () => {
  test("SIGTERM (what `docker stop` sends) ends the process cleanly and fast", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createNetServer().listen(0, "127.0.0.1", () => {
        const free = (probe.address() as { port: number }).port;
        probe.close(() => resolve(free)); // a port that is free right now
      });
    });
    const child = spawn(process.execPath, ["--import", "tsx", "day-19/http-server.ts"], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
    const giveUp = { timer: undefined as NodeJS.Timeout | undefined };
    await new Promise<void>((resolve, reject) => {
      let log = "";
      child.stderr!.on("data", (d) => {
        log += d;
        if (/listening on/.test(log)) resolve();
      });
      child.once("exit", () => reject(new Error(`exited early: ${log}`)));
      giveUp.timer = setTimeout(() => reject(new Error("did not start")), 15000);
    }).finally(() => clearTimeout(giveUp.timer));
    const started = Date.now();
    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    const { code, signal } = await exit;
    assert.equal(signal, null);
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 3000);
  });
});
