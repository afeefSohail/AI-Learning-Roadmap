import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { executeTool, toolDefinitions } from "./tools";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-5-5";
const PRICE_INPUT_TOKENS = 0.1;
const PRICE_OUTPUT_TOKENS = 0.5;

const question = process.argv.slice(2).join(" ") || "What is 1847 times 392?";
const useTools = !process.env.NO_TOOLS; // NO_TOOLS=1 sends the request without tools

let inputTokens = 0;
let outTokens = 0;

function show(label: string, res: Anthropic.Message) {
  inputTokens += res.usage.input_tokens;
  outTokens += res.usage.output_tokens;
  console.log(
    `${label} | stop_reason: ${res.stop_reason} | ${res.usage.input_tokens} input_tokens / ${res.usage.output_tokens} output_tokens`,
  );
  for (const block of res.content) {
    if (block.type === "text") console.log(`  text: ${block.text}`);
    else if (block.type === "tool_use")
      console.log(
        `  tool_use: ${block.name} ${JSON.stringify(block.input)}  (id ${block.id})`,
      );
    else console.log(`  [${block.type} block]`);
  }
}

console.log(`QUESTION: ${question}\n`);

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: question },
];

const first = await client.messages.create({
  model: MODEL,
  max_tokens: 1000,
  ...(useTools ? { tools: toolDefinitions } : {}),
  messages,
});
show("REQUEST 1", first);

// when every we use tools other then server tools stop_reason === "tool_use"
if (first.stop_reason === "tool_use") {
  // Keep the assistant turn exactly as it came back
  messages.push({ role: "assistant", content: first.content });

  // Run every tool Claude asked for and build one tool_result per tool_use
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of first.content) {
    if (block.type !== "tool_use") continue;
    const { content, isError } = executeTool(block.name, block.input);
    console.log(`  ran ${block.name} -> ${isError ? "ERROR: " : ""}${content}`);
    results.push({
      type: "tool_result",
      tool_use_id: block.id, // must match the tool_use block's id
      content,
      ...(isError ? { is_error: true } : {}),
    });
  }

  messages.push({ role: "user", content: results }); // all results in ONE user message

  // Request 2: send the results back. Keep sending the same tools.
  const second = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    tools: toolDefinitions,
    messages,
  });
  console.log();
  
  show("REQUEST 2", second);
  
  if (second.stop_reason === "tool_use") {
    console.log("\n(Claude wants another tool call. One round isn't enough: that is the loop you build on Day 7.)");
  }
}

const cost = (inputTokens * PRICE_INPUT_TOKENS + outTokens * PRICE_OUTPUT_TOKENS) / 1_000_000;
console.log(`\nTotal: ${inputTokens} in / ${outTokens} out | $${cost.toFixed(6)}`);