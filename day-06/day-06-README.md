# Day 06: Tool calling basics

**Week 2: Tool calling and APIs**

## What I built

- `tools.ts`: two tools, `calculator` (add, subtract, multiply, divide) and `get_current_time` (any IANA time zone). Each tool is defined once with a Zod schema. The same definition produces the JSON Schema sent to the API and validates the input the model sends back. `executeTool` runs a tool and returns an error result instead of crashing if the input is invalid or the tool throws.
- `ask.ts`: asks one question, runs one tool round trip, and prints every step with token usage and cost.

```bash
- npx tsx day-06/ask.ts "What is 1847 times 392?"
- NO_TOOLS=1 npx tsx day-06/ask.ts "What is 1847 times 392?"   # same question without tools
- NO_TOOLS=0 npx tsx day-06/ask.ts "What is the capital of France?" 
- NO_TOOLS=0 npx tsx day-06/ask.ts "What time is it in Tokyo?"  
- NO_TOOLS=0 npx tsx day-06/ask.ts "What time is it in Lahore, and what is 15% of 2480?"
- NO_TOOLS=0 npx tsx day-06/ask.ts "What is (12 + 8) times 5?"
- NO_TOOLS=0 npx tsx day-06/ask.ts "What is 10 divided by 0?"
```

## Key idea: the model never runs anything

The model only asks. My code runs the tool and reports the result.

```
request 1: question + tool definitions
  -> reply has stop_reason "tool_use" and a tool_use block (name, input, id)
my code runs the tool
request 2: history + assistant's tool_use message + a user message holding the tool_result (same id)
  -> reply has stop_reason "end_turn" and the final answer
```

Rules:
- Push the assistant's whole `content` into the history, unchanged (thinking blocks included).
- Send all `tool_result` blocks in ONE user message right after the assistant message, `tool_result` blocks first.
- Each `tool_result` carries the `tool_use_id` of the call it answers.
- If a tool fails, return the error text with `is_error: true`. The model can then explain it or try again.
- Send `tools` again in request 2.
- If request 2 still ends in `tool_use`, the model wants more tools. Handling that is a loop (Day 7).

## Results

| Question | Tools called | Request 1 (in / out) | Request 2 (in / out) | Total in / out | Cost |
|---|---|---|---|---|---|
| 1847 times 392 | calculator | 644 / 93 | 744 / 16 | 1,388 / 109 | $0.000193 |
| Capital of France (tools sent) | none | 642 / 12 | none | 642 / 12 | $0.000070 |
| Capital of France (NO_TOOLS) | none | 16 / 14 | none | 16 / 14 | $0.000009 |
| Time in Tokyo | get_current_time | 645 / 59 | 748 / 41 | 1,393 / 100 | $0.000189 |
| Time in Lahore and 15% of 2480 | both, in one reply | 655 / 150 | 900 / 60 | 1,555 / 210 | $0.000260 |

Costs recomputed from the token counts at $0.10 / M input and $0.50 / M output.

## Findings

### 1. Tool definitions are a fixed cost on every request

Two small tools add about 626 input tokens (642 with tools vs 16 without). I pay this on every request, even when the model calls nothing. "Capital of France" cost about 8x more with tools sent than without. Send only the tools a request might need.

### 2. The model chooses whether to use a tool

For France, it answered directly. For the multiplication and the time questions, it called the right tool with correct arguments. The descriptions are what it reads to decide, so they matter ("Use this whenever the user asks about the current time").

### 3. Without the time tool, the model says it can't know

Before the tools worked, it replied that it can't see the current time. It did not invent one. With the tool, it returned the real time.

### 4. Request 2 resends everything

Request 2's input (744) is request 1's input (644) plus the assistant's `tool_use` message and my `tool_result`. This is the stateless API again.

### 5. Parallel tool calls

"What time is it in Lahore, and what is 15% of 2480?" produced two `tool_use` blocks in one reply, and I returned both results in one user message. The model turned "15% of" into `multiply 2480 0.15` using only the four operations it had.

### 6. Hidden thinking shows up again

The first reply on the calculator question used 93 output tokens for a tiny tool call, and a `[thinking block]` appeared in `content`. Thinking blocks count as output and must be sent back with the assistant message.

### 7. Easy questions skip the tool

When I first tested, small arithmetic like `(12 + 8) * 5` was answered without the calculator. The model decides. For anything that must be exact, make the system prompt require the tool, or use larger numbers.

## Experiments

- **Divide by zero:** "What is 10 divided by 0?" The calculator threw, my code returned `ERROR: Cannot divide by zero.` as an error result, and the model explained that division by zero is undefined. Nothing crashed. The failure cost an extra round trip (1,461 in / 221 out, $0.000257).
- **Dependent calls:** "What is (12 + 8) times 5?" I expected two sequential rounds. The model sent both calls at once and guessed `20` for the multiplication before the addition returned (1,531 in / 389 out, $0.000348). The guess was right, and the model said so afterwards, but it was still a guess. Dependent calls cannot be trusted to run in order. Day 7: tell the model to wait when one call needs another's result, and log every call.
- **Repeat runs after fixing the totals:** the same questions gave almost the same numbers (1847 times 392: 1,388 in / 108 out; Tokyo: 1,393 / 103; Lahore and 15%: 1,555 / 209). The input counts are identical, because the prompt and tools are identical. The output counts differ by a few tokens, because the model's reply varies. The `Total` line now matches my hand calculation, so the fix worked.
- **Break it on purpose:** I put a `{ type: "text" }` block before the `tool_result` blocks. Result: __ (paste the 400 message). Then I restored `content: results`.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| Model never used a tool; input tokens were 16-29 | The tools were not reaching the API (the tools option was off in the request) | Print `useTools` and the definition count; input tokens in the hundreds proves they are sent |
| Totals showed the same number for in and out | Both counters added input and output tokens together | `tokensIn += usage.input_tokens; tokensOut += usage.output_tokens` |
| `Tools Defination: [object Object]` | An array inside a template string | `JSON.stringify(toolDefinitions, null, 2)` |

Lesson: when nothing happens, check the token counts first. They show what was actually sent.

## Rules of thumb

- The model asks, my code runs.
- Match every `tool_use` id with a `tool_result`, in the next user message.
- Return failures as `is_error` results, not crashes.
- Tools cost input tokens on every request.
- Treat tool output as untrusted text.
- Parallel calls can be independent or guessed. Check steps that depend on each other.

## Next (Day 7)

Replace the single round trip with a loop: keep going while `stop_reason === "tool_use"`, handle parallel calls, add a maximum step count, and log each step.

## Reading

- [Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [How to implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Handle Tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- [Tutorial: Build a tool-using agent](https://platform.claude.com/docs/en/agents-and-tools/tool-use/build-a-tool-using-agent)
