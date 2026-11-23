import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { CANCELLED, CANNOT_ASK, confirmKey, NAME_MAX, NOT_FOUND } from "./create-server";
import { startHttpServer } from "./http-server";
import { deletes, reset, startMockApi, state, writes } from "./mock-api";

let api: { server: Server; url: string };
let mcp: Server;
let mcpUrl: URL;

before(async () => {
  api = await startMockApi();
  process.env.USERAUTH_BASE_URL = api.url;
  process.env.USERAUTH_WRITE_TIMEOUT_MS = "300"; // short, so the timeout test is quick
  mcp = await startHttpServer(0);
  mcpUrl = new URL(`http://127.0.0.1:${(mcp.address() as { port: number }).port}/mcp`);
});
after(() => {
  mcp.close();
  api.server.close();
});
beforeEach(() => reset());

type Reply = { action: "accept" | "decline" | "cancel"; confirm?: boolean };
type Opts = { elicit?: Reply | "none"; mode?: "auto" | "legacy"; rewrite?: (body: any) => any };

/** A client that answers confirmation questions the way the test says, and remembers the questions. */
async function connect(token: string, opts: Opts = {}) {
  const prompts: string[] = [];
  const rewrite = opts.rewrite;
  const myFetch: typeof fetch = async (input, init) => {
    if (rewrite && typeof init?.body === "string") init = { ...init, body: JSON.stringify(rewrite(JSON.parse(init.body))) };
    return fetch(input, init);
  };
  const elicit = opts.elicit ?? { action: "accept", confirm: true };
  const client = new Client(
    { name: "test", version: "1.0.0" },
    { versionNegotiation: { mode: opts.mode ?? "auto" }, ...(elicit === "none" ? {} : { capabilities: { elicitation: {} } }) } as never,
  );
  if (elicit !== "none") {
    (client as any).setRequestHandler("elicitation/create", async (req: any) => {
      prompts.push(req.params.message);
      return elicit.action === "accept" ? { action: "accept", content: { confirm: elicit.confirm ?? true } } : { action: elicit.action };
    });
  }
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: myFetch }),
  );
  return { client, prompts };
}
const text = (r: { content: unknown }) => (r.content as Array<{ text: string }>)[0]!.text;
const del = (client: Client, photoId: number) => client.callTool({ name: "delete_photo", arguments: { photoId } });

describe("delete_photo asks first", () => {
  test("1. the user declines: the API is not called to delete, and the tool says it was cancelled", async () => {
    const { client } = await connect("token-a", { elicit: { action: "decline" } });
    const r = await del(client, 11);
    assert.equal(r.isError, undefined);
    assert.equal(text(r), CANCELLED);
    assert.equal(deletes().length, 0);
    assert.ok(state.photos.some((p) => p.id === 11));
    await client.close();
  });

  test("1b. the user dismisses the question (cancel) or answers confirm: false: nothing is deleted", async () => {
    for (const reply of [{ action: "cancel" }, { action: "accept", confirm: false }] as Reply[]) {
      const { client } = await connect("token-a", { elicit: reply });
      assert.equal(text(await del(client, 11)), CANCELLED);
      await client.close();
    }
    assert.equal(deletes().length, 0);
  });

  test("2. a client that cannot ask: fails closed with a tool error, before any API call", async () => {
    const { client } = await connect("token-a", { elicit: "none" });
    const r = await del(client, 11);
    assert.equal(r.isError, true);
    assert.equal(text(r), CANNOT_ASK);
    assert.equal(state.calls.length, 0);
    await client.close();
  });

  test("2b. a 2025-era client fails closed the same way", async () => {
    const { client } = await connect("token-a", { mode: "legacy" });
    const r = await del(client, 11);
    assert.equal(r.isError, true);
    assert.equal(text(r), CANNOT_ASK);
    assert.equal(state.calls.length, 0);
    await client.close();
  });

  test("3. the user accepts for their own photo: one DELETE with their token, and the question names the photo", async () => {
    const { client, prompts } = await connect("token-a");
    const r = await del(client, 11);
    assert.equal(r.isError, undefined);
    assert.equal(text(r), "Photo 11 was deleted.");
    assert.equal(deletes().length, 1);
    assert.equal(deletes()[0]!.token, "token-a");
    assert.equal(deletes()[0]!.path, "/user/photos/11");
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Delete photo 11\?/);
    assert.match(prompts[0]!, /a-11\.jpg/);
    assert.ok(!state.photos.some((p) => p.id === 11));
    await client.close();
  });

  test("4. a missing photo and someone else's photo look the same, and the user is never asked", async () => {
    const { client, prompts } = await connect("token-b");
    const other = await del(client, 11); // belongs to A
    const missing = await del(client, 999);
    assert.equal(other.isError, true);
    assert.equal(text(other), NOT_FOUND);
    assert.equal(text(missing), NOT_FOUND);
    assert.equal(prompts.length, 0);
    assert.equal(deletes().length, 0);
    assert.ok(state.photos.some((p) => p.id === 11));
    await client.close();
  });

  test("8. an answer for one photo is not accepted for another", async () => {
    // The client renames its answer to the key of photo 11 while the call is about photo 12.
    const stale = (body: any) => {
      if (body?.params?.inputResponses) {
        const [[, value]] = Object.entries(body.params.inputResponses);
        body.params.inputResponses = { [confirmKey(11)]: value };
      }
      return body;
    };
    const { client } = await connect("token-a", { rewrite: stale });
    await del(client, 12).catch(() => {}); // it keeps asking until the client gives up
    assert.equal(deletes().length, 0);
    assert.ok(state.photos.some((p) => p.id === 12));
    await client.close();
  });
});

describe("a write that fails is never retried and never claims to be safe to retry", () => {
  test("5. the DELETE times out after the user said yes: outcome unknown, one attempt only", async () => {
    const { client } = await connect("slow");
    const r = await del(client, 11);
    assert.equal(r.isError, true);
    assert.match(text(r), /may or may not have happened/);
    assert.match(text(r), /Do not call this tool again/);
    assert.match(text(r), /list_photos/);
    assert.doesNotMatch(text(r), /try again|retry the/i);
    await new Promise((resolve) => setTimeout(resolve, 1400)); // let the slow answer arrive
    assert.equal(deletes().length, 1); // no second attempt
    assert.ok(!state.photos.some((p) => p.id === 11)); // and the delete did happen: the tool could not know
    await client.close();
  });

  test("5b. a 5xx on the DELETE gives the same answer and one attempt", async () => {
    const { client } = await connect("boom-write");
    const r = await del(client, 11);
    assert.equal(r.isError, true);
    assert.match(text(r), /may or may not have happened/);
    assert.equal(deletes().length, 1);
    await client.close();
  });

  test("5c. a 5xx on update_profile gives the unknown-outcome answer and one attempt", async () => {
    const { client } = await connect("boom-write");
    const r = await client.callTool({ name: "update_profile", arguments: { name: "New Name" } });
    assert.equal(r.isError, true);
    assert.match(text(r), /may or may not have happened/);
    assert.match(text(r), /get_me/);
    assert.equal(writes().length, 1);
    await client.close();
  });

  test("an expired token becomes an HTTP 401 for the client, and nothing was written", async () => {
    const { client } = await connect("old-token");
    await assert.rejects(() => client.callTool({ name: "update_profile", arguments: { name: "New Name" } }), /invalid_token/);
    assert.equal(writes().length, 1); // one attempt, rejected by the API
    assert.equal(state.users["token-a"]!.name, "Alice Example");
    await client.close();
  });
});

describe("update_profile", () => {
  test("6. it changes the name and sends nothing but the name", async () => {
    const { client } = await connect("token-a");
    const r = await client.callTool({ name: "update_profile", arguments: { name: "  Alice Changed  ", email: "evil@example.com" } as never });
    if (!r.isError) assert.deepEqual(JSON.parse(text(r)), { id: 1, email: "a@example.com", name: "Alice Changed" });
    for (const call of writes()) assert.deepEqual(Object.keys(call.body as object), ["name"]);
    assert.equal(state.users["token-a"]!.email, "a@example.com");
    await client.close();
  });

  test("6b. an empty name and a name over the limit are rejected before any API call", async () => {
    const { client } = await connect("token-a");
    for (const name of ["", "   ", "x".repeat(NAME_MAX + 1)]) {
      const r = await client.callTool({ name: "update_profile", arguments: { name } });
      assert.equal(r.isError, true, `name of length ${name.length}`);
    }
    assert.equal(state.calls.length, 0);
    await client.close();
  });
});

describe("what tools/list promises", () => {
  test("7. annotations are what Q1 says, and no tool takes a userId or a token", async () => {
    const { client } = await connect("token-a");
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(Object.keys(by).sort(), ["delete_photo", "get_me", "get_photo", "list_photos", "update_profile"]);
    for (const name of ["update_profile", "delete_photo"]) {
      assert.deepEqual(by[name]!.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    }
    for (const name of ["get_me", "list_photos", "get_photo"]) assert.equal(by[name]!.annotations?.readOnlyHint, true);
    for (const t of tools) {
      const props = Object.keys((t.inputSchema as { properties?: object }).properties ?? {});
      assert.ok(!props.some((p) => /user|token|email/i.test(p)), `${t.name} has ${props}`);
    }
    await client.close();
  });
});
