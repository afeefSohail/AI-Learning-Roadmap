import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { connectMcp } from "./mcp-client.ts";

const MODEL = "claude-haiku-5-5";
const MAX_STEPS = 8;
const SYSTEM =
  "You are a helpful assistant. Use the tools when you need exact data. " +
  "If a tool call depends on another tool's result, wait for that result before calling it.";

const question = process.argv.slice(2).join(" ") || "How many PKR is 250 EUR?";

const client = new Anthropic();
const mcp = await connectMcp("npx", ["tsx", "day-13/server.ts"]);

// MCP tool -> Anthropic tool: only the field names differ (inputSchema -> input_schema)
const tools: Anthropic.Tool[] = mcp.tools.map((t) => ({
  name: t.name,
  description: t.description ?? "",
  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
}));
console.log(`MCP tools: ${tools.map((t) => t.name).join(", ")}`);

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: question },
];
let exit = "step_limit";

try {
  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools,
      messages,
    });
    console.log(
      `step ${step}: stop_reason=${response.stop_reason} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
    );
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      exit =
        response.stop_reason === "end_turn" ? "end_turn" : `stop:${response.stop_reason}`;
      for (const block of response.content) {
        if (block.type === "text"){
          console.log(block.text);
        }
      } 

      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const toolResult = await mcp.callTool(block.name, block.input as Record<string, unknown>);
      console.log(
        `  ${block.name}(${JSON.stringify(block.input)}) -> ${toolResult.isError ? "ERROR " : ""}${toolResult.text}`,
      );
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: toolResult.text,
        is_error: toolResult.isError,
      });
    }
    
    messages.push({ role: "user", content: results });
  }
} finally {
  await mcp.close(); // stops the server child process, also on errors
}
console.log(`exit: ${exit}`);
