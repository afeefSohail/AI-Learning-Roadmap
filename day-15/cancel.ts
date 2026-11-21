import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

function createServer() {
  const s = new McpServer({ name: "slow", version: "1.0.0" });
  s.registerTool(
    "slow",
    { description: "slow", inputSchema: z.object({}) },
    async (_args, ctx) => {
      console.log("[server] started");
      try {
        await sleep(5000, undefined, { signal: ctx.mcpReq.signal });
        console.log("[server] finished the work");
        return { content: [{ type: "text", text: "done" }] };
      } catch (e) {
        console.log("[server] aborted:", (e as Error).name);
        throw e;
      }
    },
  );
  return s;
}
const handler = createMcpHandler(createServer);
const client = new Client( { name: "cancel", version: "1" }, { versionNegotiation: { mode: "auto" } } );
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://t.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  }),
);
const t0 = Date.now();
try {
  await client.callTool({ name: "slow", arguments: {} }, { timeout: 1000 });
} catch (e) {
  console.log(`[client] after ${Date.now() - t0} ms:`, (e as Error).message);
}
await new Promise(r => setTimeout(r, 5000))
console.log("[end]");
await client.close();
await handler.close();
