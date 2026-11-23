// Experiment, not a test: run with npx tsx day-18/probe.ts and read the table. 
// The real checks are in server.test.ts.

// Size of the tool definitions as they would be sent to the model (name, description, input_schema).
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createServer } from "./create-server";

const handler = createMcpHandler(createServer, { responseMode: "json" });
const client = new Client({ name: "m", version: "0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://x/mcp"), { fetch: ((i: any, n?: any) => handler.fetch(new Request(i, n))) as any }),
);
const { tools } = await client.listTools();
let total = 0;
for (const t of tools) {
  const forModel = JSON.stringify({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema });
  total += forModel.length;
  console.log(t.name.padEnd(14), String(forModel.length).padStart(5), "chars", ` ~${Math.round(forModel.length / 4)} to ${Math.round(forModel.length / 3)} tokens`);
}
console.log("TOTAL".padEnd(14), String(total).padStart(5), "chars", ` ~${Math.round(total / 4)} to ${Math.round(total / 3)} tokens`);
console.log("raw tools/list JSON:", JSON.stringify(tools).length, "chars (includes annotations, titles)");
process.exit(0);
