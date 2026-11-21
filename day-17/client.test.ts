import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { startHttpServer } from "./http-server";
import { connectUserAuthMcp, ReauthRequiredError } from "./mcp-http-client";
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

const json = (response: { content: unknown }) => JSON.parse((response.content as Array<{ text: string }>)[0]!.text);

describe("refresh on 401", () => {
  test("an expired access token is refreshed and the call succeeds without the caller noticing", async () => {
    const tokens = { accessToken: "expired-token", refreshToken: "refresh-a" };
    const before = stats.refreshCalls;
    const c = await connectUserAuthMcp(mcpUrl, api.url, tokens);
    const me = json(await c.callTool({ name: "get_me", arguments: {} }));
    assert.equal(me.email, "a@example.com");
    assert.equal(tokens.accessToken, "token-a");
    assert.equal(stats.refreshCalls - before, 1);
    // the next call uses the new token and does not refresh again
    await c.callTool({ name: "list_photos", arguments: {} });
    assert.equal(stats.refreshCalls - before, 1);
    await c.close();
  });

  test("parallel calls with an expired token trigger one refresh", async () => {
    const tokens = { accessToken: "expired-token", refreshToken: "refresh-a" };
    const c = await connectUserAuthMcp(mcpUrl, api.url, tokens);
    const before = stats.refreshCalls;
    const results = await Promise.all([
      c.callTool({ name: "get_me", arguments: {} }),
      c.callTool({ name: "list_photos", arguments: {} }),
      c.callTool({ name: "get_photo", arguments: { photoId: 11 } }),
    ]);
    for (const r of results) assert.notEqual(r.isError, true);
    assert.equal(stats.refreshCalls - before, 1);
    await c.close();
  });

  test("a refresh token that is no longer valid ends in ReauthRequiredError", async () => {
    const tokens = { accessToken: "expired-token", refreshToken: "bad-refresh" };
    // the failed refresh happens while connecting or on the first call
    await assert.rejects(
      async () => {
        const c = await connectUserAuthMcp(mcpUrl, api.url, tokens);
        await c.callTool({ name: "get_me", arguments: {} });
      },
      (err: Error) => {
        console.log("reauth error:", err.constructor.name, "|", err.message);
        return err instanceof ReauthRequiredError || /re-authorize/i.test(err.message) || (err.cause instanceof ReauthRequiredError);
      },
    );
  });
});
