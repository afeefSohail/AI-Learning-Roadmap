import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Start the real server file as a child process, the way Claude Code or my agent does.
const SERVER = ["--import", "tsx", "day-15/server.ts"];

test("the real stdio server starts, lists its tool and answers a call", async () => {
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: SERVER, stderr: "ignore" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["get_exchange_rate"]);
    const r = await client.callTool({ name: "get_exchange_rate", arguments: { from: "USD", to: "PKR" } });
    assert.equal((r.content as Array<{ text: string }>)[0]!.text, "277.35");
  } finally {
    await client.close();
  }
});

test("closing stdin makes the server exit by itself", async () => {
  const child = spawn(process.execPath, SERVER, { stdio: ["pipe", "ignore", "ignore"] });
  await new Promise((r) => setTimeout(r, 1500)); // let it start
  child.stdin.end();
  const code = await Promise.race([
    new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c))),
    new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 5000)),
  ]);
  if (code === "still running") child.kill();
  assert.notEqual(code, "still running");
  console.log("exit code after stdin closed:", code);
});

test("stdout carries only JSON-RPC messages", async () => {
  const child = spawn(process.execPath, SERVER, { stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }) + "\n");
  await new Promise((r) => setTimeout(r, 2500));
  child.kill();
  const lines = out.split("\n").filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, "2.0");
});
