import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startHttpServer } from "./http-server";
import { startMockApi, stats } from "./mock-api";

let api: { server: Server; url: string };
let mcp: Server;
let mcpUrl: URL;

before(async () => {
  api = await startMockApi();
  process.env.USERAUTH_BASE_URL = api.url;
  mcp = await startHttpServer(0);
  mcpUrl = new URL(`http://127.0.0.1:${(mcp.address() as { port: number }).port}/mcp`);
});
after(() => {
  mcp.close();
  api.server.close();
});

async function connect(token?: string) {
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return client;
}
const text = (response: { content: unknown }) => (response.content as Array<{ text: string }>)[0]!.text;
const json = (response: { content: unknown }) => JSON.parse(text(response));

describe("read tools with a valid token", () => {
  test("tools/list shows three read-only tools and no userId or token input", async () => {
    const client = await connect("token-a");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_me", "get_photo", "list_photos"]);
    for (const tool of tools) {
      const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
      assert.ok(!props.some((p) => /user|token/i.test(p)), `${tool.name} has ${props}`);
      assert.equal(tool.annotations?.readOnlyHint, true);
    }
    await client.close();
  });

  test("get_me returns the profile with absolute photo URLs and no extra fields", async () => {
    const client = await connect("token-a");
    const me = json(await client.callTool({ name: "get_me", arguments: {} }));
    assert.equal(me.email, "a@example.com");
    assert.deepEqual(Object.keys(me).sort(), ["createdAt", "email", "id", "name", "photos"]);
    assert.equal(me.photos[0].url, `${api.url}/uploads/1731950000000-482913776.jpg`);
    assert.deepEqual(Object.keys(me.photos[0]).sort(), ["createdAt", "id", "url"]);
    await client.close();
  });

  test("list_photos: newest first, and an empty list is a normal result", async () => {
    const clientA = await connect("token-a");
    assert.deepEqual(json(await clientA.callTool({ name: "list_photos", arguments: {} })).map((photo: { id: number }) => photo.id), [11, 10]);
    await clientA.close();
    const clientB = await connect("token-b");
    const response = await clientB.callTool({ name: "list_photos", arguments: {} });
    assert.notEqual(response.isError, true);
    assert.deepEqual(json(response), []);
    await clientB.close();
  });

  test("get_photo returns my photo", async () => {
    const client = await connect("token-a");
    assert.equal(json(await client.callTool({ name: "get_photo", arguments: { photoId: 11 } })).id, 11);
    await client.close();
  });

  test("get_photo gives the same 404 for someone else's photo and a missing one", async () => {
    const clientB = await connect("token-b");
    const other = await clientB.callTool({ name: "get_photo", arguments: { photoId: 11 } });
    const missing = await clientB.callTool({ name: "get_photo", arguments: { photoId: 999 } });
    assert.equal(other.isError, true);
    assert.equal(text(other), text(missing));
    assert.equal(text(other), "Photo not found");
    await clientB.close();
  });

  test("bad photoId is rejected by the schema before any API call", async () => {
    const client = await connect("token-a");
    const before = stats.calls;
    for (const photoId of [0, -3, 1.5, "7"]) {
      const response = await client.callTool({ name: "get_photo", arguments: { photoId } });
      assert.equal(response.isError, true, String(photoId));
    }
    assert.equal(stats.calls, before);
    await client.close();
  });
});

describe("401 handling", () => {
  test("an expired or invalid token becomes an HTTP 401, not a tool result", async () => {
    const client = await connect("expired-token");
    await assert.rejects(client.callTool({ name: "get_me", arguments: {} }), (err: Error) => {
      console.log("client error for 401:", err.name, "|", err.message.slice(0, 120));
      return true;
    });
    await client.close().catch(() => {});
  });

  test("a 2025-era request (no envelope, streamed answer) also gets the 401 status and header", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer expired-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_me", arguments: {} } }),
    });
    console.log("raw status:", res.status, "| www-authenticate:", res.headers.get("www-authenticate"));
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /invalid_token/);
    assert.doesNotMatch(await res.text(), /expired-token/);
  });

  test("no token: tools/list works, a tool call is a 401 and makes no API call", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    assert.equal(tools.length, 3);
    const before = stats.calls;
    await assert.rejects(c.callTool({ name: "get_me", arguments: {} }));
    assert.equal(stats.calls, before);
    await c.close().catch(() => {});
  });
});

describe("failures of the API", () => {
  test("a 500 on a read is retried once by the server, then the model is told not to retry", async () => {
    const c = await connect("boom");
    const before = stats.calls;
    const r = await c.callTool({ name: "get_me", arguments: {} });
    assert.equal(r.isError, true);
    assert.equal(text(r), "The service is unavailable. Do not retry; tell the user.");
    assert.equal(stats.calls - before, 2);
    await c.close();
  });

  test("one transient 500 is hidden by the retry", async () => {
    const c = await connect("flaky");
    const r = await c.callTool({ name: "get_me", arguments: {} });
    assert.notEqual(r.isError, true);
    assert.equal(json(r).email, "a@example.com");
    await c.close();
  });

  test("the token never appears in a tool result", async () => {
    const c = await connect("token-a");
    const all = [await c.callTool({ name: "get_me", arguments: {} }), await c.callTool({ name: "list_photos", arguments: {} })];
    for (const r of all) assert.doesNotMatch(text(r), /token-a|Bearer/);
    await c.close();
  });
});
