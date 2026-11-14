import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer, createServer } from "./create-server";

let client: Client;
let handler: ReturnType<typeof createMcpHandler>;

async function start(server: () => ReturnType<typeof createServer> = createServer) {
  handler = createMcpHandler(server);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  client = new Client({ name: "test-harness", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
}

beforeEach(() => start());

afterEach(async () => {
  await client.close();
  await handler.close();
});

const text = (r: { content: unknown }) => (r.content as Array<{ text: string }>)[0]!.text;
const call = (args: Record<string, unknown>) => client.callTool({ name: "get_exchange_rate", arguments: args });

describe("tool: get_exchange_rate", () => {

  test("is listed with an honest description", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 1);
    const toolDescription = tools[0]!.description ?? "";
    assert.match(toolDescription, /DEMO/);
    assert.match(toolDescription, /not live market data/);
    for (const code of ["USD", "PKR", "EUR", "GBP", "JPY"]) assert.ok(toolDescription.includes(code), code);
  });

  test("USD to PKR", async () => {
    const toolResult = await call({ from: "USD", to: "PKR" });
    assert.notEqual(toolResult.isError, true);
    assert.equal(text(toolResult), "277.35");
  });

  test("result is rounded to 6 significant digits", async () => {
    assert.equal(text(await call({ from: "EUR", to: "PKR" })), "303.546");
  });

  test("lowercase and spaces are accepted", async () => {
    assert.equal(text(await call({ from: " usd ", to: "pkr" })), "277.35");
  });

  test("GBP to JPY", async () => {
    assert.equal(text(await call({ from: "GBP", to: "JPY" })), "196.343");
  });

  test("same currency returns 1", async () => {
    assert.equal(text(await call({ from: "USD", to: "USD" })), "1");
  });

  test("empty from is an error that explains what is expected", async () => {
    const toolResult = await call({ from: "", to: "PKR" });
    assert.equal(toolResult.isError, true);
    assert.match(text(toolResult), /3-letter/i);
  });


  test("unknown currency is an isError result that lists the supported codes", async () => {
    const toolResult = await call({ from: "USD", to: "INR" });
    assert.equal(toolResult.isError, true);
    assert.match(text(toolResult), /Unknown currency: INR/);
    assert.match(text(toolResult), /Supported currencies: USD, PKR, EUR, GBP, JPY/);
  });

  test("missing argument is an isError result from the SDK validation", async () => {
    const toolResult = await call({ from: "USD" });
    assert.equal(toolResult.isError, true);
    assert.match(text(toolResult), /to/);
  });

  test("a bug in the tool returns a generic error and does not leak the message", async () => {
    await client.close();
    await handler.close();
    await start(() => buildServer({ rateFor: () => { throw new Error("secret db password in stack"); } }));
    const r = await call({ from: "USD", to: "PKR" });
    assert.equal(r.isError, true);
    assert.match(text(r), /Internal error/);
    assert.doesNotMatch(text(r), /secret/);
  });
  
  test("unknown tool name rejects (protocol error)", async () => {
    await assert.rejects(client.callTool({ name: "nope", arguments: {} }), /not found/i);
  });
});

describe("resource and prompt", () => {
  test("rates://usd returns the table", async () => {
    const response = await client.readResource({ uri: "rates://usd" });
    const rates_table = JSON.parse((response.contents[0] as { text: string }).text);
    assert.equal(rates_table.PKR, 277.35);
  });

  test("unknown resource rejects", async () => {
    await assert.rejects(client.readResource({ uri: "rates://nope" }), /not found/i);
  });

  test("prompt fills in its arguments", async () => {
    const prompt = await client.getPrompt({ name: "convert-and-explain", arguments: { amount: "100", from: "USD", to: "PKR" } });
    const message = prompt.messages[0]!.content as { text: string };
    assert.match(message.text, /Convert 100 USD to PKR/);
  });

  test("prompt with a missing argument rejects", async () => {
    await assert.rejects(client.getPrompt({ name: "convert-and-explain", arguments: { amount: "100" } }), /Invalid arguments/);
  });
});
