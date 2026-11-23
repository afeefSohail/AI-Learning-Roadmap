// Experiment, not a test: run with npx tsx day-18/probe.ts and read the table. 
// The real checks are in server.test.ts.

import { McpServer, createMcpHandler, inputRequired } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";

let apiCalls = 0;
function factory() {
  const server = new McpServer({ name: "probe", version: "0.0.1" });
  // 2026 style: answer with input_required, read the answer on the retry
  server.registerTool(
    "delete_photo",
    { inputSchema: z.object({ photoId: z.number() }), annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false } },
    async ({ photoId }, ctx) => {
      const r = (ctx.mcpReq.inputResponses as Record<string, any> | undefined)?.confirm;
      if (!r) {
        return inputRequired({
          inputRequests: { confirm: inputRequired.elicit({ message: `Delete photo ${photoId}?`, requestedSchema: z.object({ confirm: z.boolean() }) }) },
        });
      }
      if (r.action !== "accept" || r.content?.confirm !== true) return { content: [{ type: "text", text: "Deletion cancelled." }] };
      apiCalls++;
      return { content: [{ type: "text", text: `Deleted ${photoId}` }] };
    },
  );
  // 2025 style: ask the client in the middle of the call
  server.registerTool(
    "delete_photo_legacy",
    { inputSchema: z.object({ photoId: z.number() }) },
    async ({ photoId }, ctx) => {
      try {
        const r = await ctx.mcpReq.elicitInput(
          { mode: "form", message: `Delete photo ${photoId}?`, requestedSchema: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"] } },
          { timeout: 4000 },
        );
        if (r.action !== "accept" || r.content?.confirm !== true) return { content: [{ type: "text", text: "Deletion cancelled." }] };
        apiCalls++;
        return { content: [{ type: "text", text: `Deleted ${photoId}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Cannot ask for confirmation: ${(e as Error).message}` }] };
      }
    },
  );
  return server;
}

async function run(label: string, opts: { buffer: boolean; mode: any; elicit: "accept" | "decline" | "none"; tool: string }) {
  apiCalls = 0;
  const handler = createMcpHandler(factory, { responseMode: "json" });
  const f = async (input: any, init?: any) => {
    let res = await handler.fetch(new Request(input, init));
    if (opts.buffer && (init?.method ?? "GET") === "POST") res = new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers });
    return res;
  };
  const client = new Client({ name: "c", version: "0" }, {
    versionNegotiation: { mode: opts.mode },
    ...(opts.elicit !== "none" ? { capabilities: { elicitation: {} } } : {}),
  } as any);
  if (opts.elicit !== "none") (client as any).setRequestHandler("elicitation/create", async () => ({ action: "accept", content: { confirm: opts.elicit === "accept" } }));
  const t0 = Date.now();
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("http://x/mcp"), { fetch: f as any }));
    const res: any = await client.callTool({ name: opts.tool, arguments: { photoId: 2 } }, { timeout: 8000 } as any);
    console.log(label.padEnd(44), "->", JSON.stringify(res.content?.[0]?.text), "isError:", !!res.isError, "| api calls:", apiCalls, `| ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(label.padEnd(44), "-> THROWN", (e as Error).name + ":", (e as Error).message.slice(0, 110), "| api calls:", apiCalls, `| ${Date.now() - t0}ms`);
  }
  await client.close().catch(() => {});
}

await run("A modern, user accepts", { buffer: false, mode: "auto", elicit: "accept", tool: "delete_photo" });
await run("B modern, user declines", { buffer: false, mode: "auto", elicit: "decline", tool: "delete_photo" });
await run("C modern, client cannot elicit", { buffer: false, mode: "auto", elicit: "none", tool: "delete_photo" });
await run("D modern, accepts, with buffering", { buffer: true, mode: "auto", elicit: "accept", tool: "delete_photo" });
await run("E legacy client, input_required tool", { buffer: false, mode: "legacy", elicit: "accept", tool: "delete_photo" });
await run("F legacy client, elicitInput, json mode", { buffer: false, mode: "legacy", elicit: "accept", tool: "delete_photo_legacy" });
await run("G legacy client, elicitInput, + buffering", { buffer: true, mode: "legacy", elicit: "accept", tool: "delete_photo_legacy" });
await run("H legacy client cannot elicit, elicitInput", { buffer: false, mode: "legacy", elicit: "none", tool: "delete_photo_legacy" });
process.exit(0);
