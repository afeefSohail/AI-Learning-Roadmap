# Day 07: Write your own agent loop

**Week 2: Tool calling and APIs**

## What I built

- `tools.ts`: Day 6's two tools (`calculator`, `get_current_time`) plus `get_exchange_rate`. The rates are made up, so the model cannot know them from training.
- `agent.ts`: `runAgent(question, maxSteps)`, a loop that keeps going while `stop_reason === "tool_use"`. It runs every tool call in a step, returns all the results in one user message, logs each step, and stops at a step limit. It returns `{ status, answer, steps, toolCalls, tokensIn, tokensOut }` instead of printing, so Day 8 can call it from an Express route.

```bash
npx tsx day-07/agent.ts "your question"
MAX_STEPS=2 npx tsx day-07/agent.ts
```

## Key idea: an agent is a loop with exits

```
repeat up to MAX_STEPS:
  call the model with the full history and the tools
  if stop_reason is not "tool_use": return          (end_turn = success, anything else = stopped early)
  push the assistant's whole content into the history
  run every tool_use block, collect the tool_result blocks
  push ONE user message with all the results
if the loop ends without returning: step_limit
```

Three ways out: `end_turn` (done), a non-`end_turn` stop such as `max_tokens` or `refusal` (stopped), and the step limit. The step limit is my code's job. The API does not have one, so without it a confused model could loop and bill me every turn.

## Design decisions (answered before coding)

| Question | Decision |
|---|---|
| When does the loop stop? | Three exits. `end_turn` is the only success. Hitting the step limit and an error are failures. |
| What happens at the step limit? | Stop calling the API and return a clear message with the status `max_steps_reached`, never a success. The message should say what was attempted, what was completed, what remains and the last tool result. |
| Several tool calls in one reply: parallel or one after another? | Read-only, independent calls can run in parallel because it is faster. Calls with side effects (sending, paying, deleting) run one at a time, optionally stopping at the first failure and skipping the rest. Either way, return all `tool_result` blocks in one user message, matched by `tool_use_id`. Every `tool_use` needs a result, even an error or "skipped". |
| What goes in the log for each step? | See the list below. |

**A production log per step:**
- `run_id`, step number and timestamp
- the model's `stop_reason` and the model latency for the step
- per tool call: `tool_use_id`, tool name, input (redacted), result (truncated, with its size), `is_error`, duration, and whether it ran in parallel
- tokens: input, output, cache read, cache write, a running total and the estimated cost
- the final status: `end_turn`, `max_steps`, `error`, `timeout` or `budget`

### What my `agent.ts` actually does

| Decision | My code today |
|---|---|
| Success vs failure | Returns `done` for `end_turn`, `stopped` for any other stop reason (such as `max_tokens` or `refusal`) and `step_limit` at the limit. |
| Message at the step limit | Only "I could not finish within N steps." It does not yet say what was done or what remains. |
| Errors | An API error throws out of `runAgent` and is not caught, so there is no `error` status yet. |
| Parallel or sequential | Always sequential, in a `for` loop, which is the safe choice but slower. All results still go back in one user message. |
| Logging | Step number, `stop_reason`, input/output tokens, then per tool call the name, input and truncated result. No `run_id`, timing, cache tokens or running cost per step. |

The list above is where the loop should go next. Today it is the minimum that is correct.

## Runs

| Question | Steps | Tool calls | Tokens in / out | Cost |
|---|---|---|---|---|
| Convert 2500 USD to PKR, then add 18% tax | 5 | 4 | 6,045 / 523 | $0.000866 |
| Same, wait sentence removed from the system prompt | 5 | 4 | 6,149 / 565 | $0.000897 |
| Time in Tokyo | 2 | 1 | 2,023 / 100 | $0.000252 |
| Capital of France | 1 | 0 | 957 / 12 | $0.000102 |
| Default question with `MAX_STEPS=2` | 2 (limit hit) | 2 | 2,088 / 215 | $0.000316 |
| Tokyo + London time + 2480 / 8 | 2 | 3 | 2,309 / 299 | $0.000380 |
| 5 + 5 + 5 + 5 + 5 | 5 | 4 | 6,118 / 456 | $0.000840 |
| 100 USD to INR (supported list in the description) | 1 | 0 | 960 / 321 | $0.000257 |
| 100 USD to INR (supported list removed) | 2 | 1 | 1,985 / 254 | $0.000326 |

Costs recomputed from the token counts at $0.10 / M input and $0.50 / M output. The first answer was correct: 2,500 x 277.35 = 693,375, tax 124,807.50, total 818,182.50.

## Findings

### 1. Input grows every step, and most of it is repeated

Input tokens in the default run: 980, 1,112, 1,214, 1,318, 1,421. The fixed part (system prompt plus three tool definitions) is about 957 tokens, as the France run shows. Over 5 steps that is about 4,785 of 6,045 input tokens, roughly 79%. The fixed part is resent every step. Caching it is on the Week 7 list.

### 2. Each step's output becomes the next step's input

Input grew by about the previous step's output plus a few tokens (output 124 then growth +132; output 95 then +102, +104, +103). The assistant's content, including hidden thinking, stays in the history. A step with a lot of thinking makes every later step more expensive.

### 3. The step limit protects the wallet, not the user

At `MAX_STEPS=2` the loop stopped while the model still wanted a tool. I paid for 2,088 in / 215 out and the user got "I could not finish". Better: one last request without tools that says "you ran out of steps, summarize what you found so far".

### 4. Independent calls in one step are cheaper

"Time in Tokyo and London, and 2480 / 8" went out as 3 calls in one step and finished in 2 steps. Run one after another it would have taken 4. Each extra step resends the whole history.

### 5. Tool design decides the step count

The calculator takes two numbers, so "5 + 5 + 5 + 5 + 5" needed 4 chained calls and 5 steps. A tool that accepted a list would need 1 call. The model can only work with the tools I give it.

### 6. The wait sentence made no visible difference here

I removed "If one tool call needs the result of another, wait for that result" from the system prompt and reran the default question. The model still called the tools one after another and guessed nothing (5 steps, same answer). Here each step obviously needs the last result, so the sentence was not needed. On Day 6 the model did guess a value, with a different question and no system prompt. This is one run each, so it shows a risk, not a rule. I put the sentence back.

### 7. Good descriptions prevent wasted calls, good errors make recovery easy

- With the supported currencies in the tool description, the model never called the tool for INR: 1 step, $0.000257.
- Without them, it called the tool, got `ERROR: Unsupported currency: INR. Supported: USD, PKR, EUR, GBP, JPY`, and explained it to me: 2 steps, $0.000326. The error text listing the supported currencies is what let it answer well. It did not invent a rate.

The description is about 20% cheaper on a bad request, and the error message is the safety net.

### 8. Hidden thinking again

The INR question with no tool call used 321 output tokens for a short refusal. Output is mostly thinking, so a short visible answer can still cost a lot.

## Errors I hit

| Problem | Fix |
|---|---|
| Copying Day 6's `tools.ts` was needed to add a tool, because `defineTool` and the `tools` array are private | Each day's folder is self-contained, so copy the file and add the new tool |

## Rules of thumb

- An agent is a loop with three exits: success, stopped early, step limit.
- Always set a maximum number of steps.
- Push the assistant's full content and send all results of a step in one user message.
- The fixed prompt and the tool definitions are resent every step. Keep both small.
- Put what the tool can and cannot do in its description, and make error messages say how to fix the request.
- Check with real numbers whether a prompt rule is needed.

## Next (Day 8)

Put `runAgent` behind an Express endpoint so a request comes in, the loop runs, and the answer goes back as JSON.

## Reading

- [How to implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
