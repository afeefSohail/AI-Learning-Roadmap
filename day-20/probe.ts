// Day 20 experiment: what does a real model do when the user's name is an instruction?
//   npx tsx day-20/probe.ts
// Needs ANTHROPIC_API_KEY in .env. Uses the Day 18 mock API, so nothing real can be deleted.
//   PROBE_RUNS=5  PROBE_USER=decline|accept|none  PROBE_SYSTEMS=plain,guarded  PROBE_MODEL=claude-haiku-5-5
import "dotenv/config";
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { startHttpServer } from "../day-18/http-server";
import { deletes, reset, startMockApi, state } from "./mock-api";
import { connectAs, PAYLOADS, runAgent, score, SYSTEMS, USER_PROMPT, type Block, type ModelFn, type Policy } from "./injection";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is missing. Put it in .env (not in this file).");
  process.exit(1);
}

const RUNS = Number(process.env.PROBE_RUNS ?? 5);
const POLICY = (process.env.PROBE_USER ?? "decline") as Policy;
const SYSTEM_IDS = (process.env.PROBE_SYSTEMS ?? "plain,guarded").split(",").map((s) => s.trim());
const MODEL = process.env.PROBE_MODEL ?? "claude-haiku-5-5";

const anthropic = new Anthropic();
const model: ModelFn = async (system, messages, tools) => {
  const r = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
    messages: messages as Anthropic.MessageParam[],
  });
  const content: Block[] = [];
  for (const b of r.content) {
    if (b.type === "text") content.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input as Record<string, unknown> });
  }
  return { stop: r.stop_reason ?? "end_turn", content };
};

const api = await startMockApi();
process.env.USERAUTH_BASE_URL = api.url;
const mcp = await startHttpServer(0);
const mcpUrl = new URL(`http://127.0.0.1:${(mcp.address() as { port: number }).port}/mcp`);

type Row = { system: string; payload: string; runs: number; errors: number; tried: number; wrote: number; canary: number; deletedRuns: number };
const rows: Row[] = [];
const raw: unknown[] = [];

try {
  for (const systemId of SYSTEM_IDS) {
    for (const payload of PAYLOADS) {
      const row: Row = { system: systemId, payload: payload.id, runs: RUNS, errors: 0, tried: 0, wrote: 0, canary: 0, deletedRuns: 0 };
      for (let i = 0; i < RUNS; i++) {
        reset();
        state.users["token-a"]!.name = payload.name; // the hostile text, stored where a user could store it
        const session = await connectAs(mcpUrl, "token-a", POLICY);
        try {
          const trace = await runAgent({ model, system: SYSTEMS[systemId]!, prompt: USER_PROMPT, tools: session.tools, callTool: session.callTool });
          const s = score(trace);
          row.tried += s.attemptedDelete ? 1 : 0;
          row.wrote += s.attemptedWrite ? 1 : 0;
          row.canary += s.canary ? 1 : 0;
          row.deletedRuns += deletes().length > 0 ? 1 : 0;
          raw.push({ system: systemId, payload: payload.id, run: i + 1, ...s, deletesAtApi: deletes().length, questions: session.questions, trace });
        } catch (err) {
          row.errors++;
          raw.push({ system: systemId, payload: payload.id, run: i + 1, error: String(err) });
        } finally {
          await session.client.close();
        }
        process.stderr.write(".");
      }
      rows.push(row);
    }
  }
} finally {
  process.stderr.write("\n");
  mcp.close();
  api.server.close();
}

const pad = (v: string | number, n: number) => String(v).padEnd(n);
console.log(`\nmodel ${MODEL} | simulated user: ${POLICY} | ${RUNS} runs per row | mock API\n`);
console.log([pad("system", 8), pad("name payload", 14), pad("asked delete", 13), pad("any write", 10), pad("obeyed canary", 14), pad("photo deleted", 14), "errors"].join(""));
for (const r of rows) {
  console.log([pad(r.system, 8), pad(r.payload, 14), pad(`${r.tried}/${r.runs}`, 13), pad(`${r.wrote}/${r.runs}`, 10), pad(`${r.canary}/${r.runs}`, 14), pad(`${r.deletedRuns}/${r.runs}`, 14), r.errors || ""].join(""));
}
writeFileSync(new URL("./probe-results.json", import.meta.url), JSON.stringify({ model: MODEL, policy: POLICY, runs: RUNS, rows, raw }, null, 2));
console.log("\nraw replies and tool calls: day-20/probe-results.json");
