import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import { toolDefinitions, executeTool } from "./tools.js";

const MODEL = "claude-haiku-5-5";
const PRICE_INPUT_TOKEN = 0.1 / 1_000_000;
const PRICE_OUTPUT_TOKEN = 0.5 / 1_000_000;
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 8);

const SYSTEM = `You are a helpful assistant with tools for arithmetic, the current time and exchange rates.
Use a tool for every calculation, time lookup and currency conversion.
If one tool call needs the result of another, wait for that result before making the call. Never guess a value that a tool call will provide.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

export type AgentResult = {
  status: "done" | "step_limit" | "stopped";
  answer: string;
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
};

const short = (s: string, n = 120) =>
  s.length > n ? s.slice(0, n) + "..." : s;

export async function runAgent(
  question: string,
  maxSteps = MAX_STEPS,
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: question },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;

  const finish = (
    status: AgentResult["status"],
    answer: string,
    steps: number,
  ): AgentResult => ({
    status,
    answer,
    steps,
    toolCalls,
    inputTokens,
    outputTokens,
  });

  for (let step = 1; step <= maxSteps; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      tools: toolDefinitions,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    console.log(
      `\nSTEP ${step} | stop_reason: ${response.stop_reason} | ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
    );

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (response.stop_reason === "end_turn")
        return finish("done", text, step);
      return finish(
        "stopped",
        `Stopped early (${response.stop_reason}). ${text}`,
        step,
      );
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (toolUses.length === 0)
      return finish(
        "stopped",
        "stop_reason was tool_use but no tool_use block was found.",
        step,
      );

    if (toolUses.length > 1)
      console.log(`  (${toolUses.length} tool calls in this step)`);

    // Keep the whole assistant content (thinking blocks included).
    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUses) {
      const out = executeTool(block.name, block.input);
      toolCalls++;
      console.log(
        `  ${block.name} ${JSON.stringify(block.input)} -> ${out.isError ? "ERROR: " : ""}${short(out.content)}`,
      );
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: out.content,
        ...(out.isError ? { is_error: true } : {}),
      });
    }

    messages.push({ role: "user", content: results });
  }

  return finish(
    "step_limit",
    `I could not finish within ${maxSteps} steps.`,
    maxSteps,
  );
}

// Run from the terminal: npx tsx day-07/agent.ts "your question"
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const question =
    process.argv[2] ??
    "Convert 2500 USD to PKR, then add 18% tax on that amount. What is the total?";
  console.log(`QUESTION: ${question} (max steps: ${MAX_STEPS})`);
  const response = await runAgent(question);
  const cost =
    response.inputTokens * PRICE_INPUT_TOKEN + response.outputTokens * PRICE_OUTPUT_TOKEN;
  console.log(`\nANSWER (${response.status}): ${response.answer}`);
  console.log(
    `\nSteps: ${response.steps} | tool calls: ${response.toolCalls} | ${response.inputTokens} in / ${response.outputTokens} out | $${cost.toFixed(6)}`,
  );
}
