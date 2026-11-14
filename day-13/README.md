# Day 13: Resources, prompts and a real MCP client

**Week 3: MCP fundamentals**

## What I read before coding

1. The Resources and Prompts sections of the [server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts.md) page, now with my own server in mind: who triggers each primitive.
2. The Resources and Prompts pages of the [MCP specification](https://modelcontextprotocol.io/specification/latest.md), under server features.
3. The v2 TypeScript SDK server guide: `registerResource` and `registerPrompt`.
4. The MCP page of the Claude Code docs, for adding a local stdio server (`claude mcp add`) and for how prompts and resources appear in the client.

**Questions I answered before coding:** see the table below.

| Question | My answer |
|---|---|
| Who picks a resource URI scheme, and fixed resource against template? | The server picks its own scheme (`rates://`). A fixed resource has an exact URI. A template has a placeholder like `rates://{currency}`. "The rate table for any currency" needs a template. |
| For a prompt with a missing argument and a resource with an unknown URI: `isError` result or protocol error? | Protocol error for both. `isError` exists only on tool results. No model is waiting to retry, because a user or the application triggers prompts and resources. |
| Rate table as a tool, a resource or both? | A resource, because the table is small and a resource costs tokens only when attached, while a tool definition costs 150 to 300 tokens in every request. For a large table that needs querying, a tool wins. With a tool the model decides, with a resource the host or user decides, with both either can. |
| Who triggers each primitive in a real client? | The model proposes the tool call. The host or user attaches the resource. The user picks the prompt, fills in its arguments, and the host expands it into messages. |

## What I built

- `day-13/server.ts`: my Day 12 exchange-rate server plus a **resource** (`rates://usd`, the rate table as JSON) and a **prompt** (`convert-and-explain` with `amount`, `from` and `to`). The tool is unchanged except for its description (see finding 8).
- `day-13/probe.mjs`: a raw JSON-RPC client that starts the server and sends seven messages.
- `day-13/screenshots/`: Inspector screenshots, the exported protocol log and Claude Code screenshots.

```bash
node day-13/probe.mjs
npx @modelcontextprotocol/inspector npx tsx day-13/server.ts
claude mcp add exchange-rate -- npx tsx /absolute/path/to/day-13/server.ts
claude mcp list
```

`claude mcp add` stored the server in the **local** scope of this project (`~/.claude.json`), so nothing goes into the repo. Remove it with `claude mcp remove exchange-rate`.

## Key idea: three primitives, three different triggers

| Primitive | Who decides | What I saw |
|---|---|---|
| Tool | The model proposes, the user approves | The model called `get_exchange_rate` by itself, and Claude Code asked for permission first |
| Resource | The application or user | I attached it with an `@` reference, and the model answered with no tool call |
| Prompt | The user | It appeared as a slash command in the menu, and I picked it and gave the arguments |

## Results

### The probe (protocol 2026-07-28)

| id | Request | Response |
|---|---|---|
| 1 | `server/discover` | Capabilities: `tools`, `resources`, `prompts` |
| 2 | `resources/list` | One resource, `rates://usd` |
| 3 | `resources/read` `rates://usd` | The rate table as JSON text |
| 4 | `prompts/list` | `convert-and-explain` with three required arguments |
| 5 | `prompts/get` with all three arguments | One user message with the values filled in |
| 6 | `prompts/get` with only `amount` | Protocol error `-32602`: `Invalid arguments for prompt convert-and-explain: from: ... to: ...` |
| 7 | `resources/read` `rates://nope` | Protocol error `-32602`: `Resource not found: rates://nope` |

### The Inspector (protocol 2025-11-25)

- The Prompts and Resources tabs worked. `resources/read` took 257 ms and `prompts/get` took 174 ms.
- `prompts/get` with `1100`, `USD`, `PKR` returned one message: `Convert 1100 USD to PKR. Use the exchange rate tool for the rate and the calculator for the arithmetic if you have one, then explain each step in two sentences.`
- The Inspector also asked for `resources/templates/list` and got an empty list, because my server has no templates.
- A tool call for PKR to EUR returned `0.003294393365783306`.

### Claude Code

| Step | What happened |
|---|---|
| `/mcp` | `exchange-rate`: connected, `Capabilities: tools · resources · prompts`, `Tools: 1 tool` |
| Type `/` | The prompt appears as `/exchange-rate:convert-and-explain (MCP)`, with my description and `(arguments: amount, from, to)` |
| `convert 2500 USD to EUR` (no slash command) | The model called `exchange-rate` by itself |
| Tool approval | Claude Code asked first and showed the tool name, the arguments and my full description, with the choices Yes, Yes and don't ask again for this tool in this project, and No |
| `@exchange-rate:rates://usd` + "Which currency has the highest rate against USD?" | Answered from the attached table: PKR, 277.35. No tool call |
| Same question in a fresh session, no `@` | "I'll check all supported currencies against USD in parallel." Called `exchange-rate` **4 times**, then the same answer and table |

## Findings

### 1. The server now declares three primitives

On Day 12, `prompts/list` and `resources/list` returned `-32601 Method not found`. Now `server/discover` lists `resources` and `prompts`, and the Inspector tabs work.

### 2. Failures differ by primitive

A bad tool call is a result with `isError: true`, so the model can read it and retry. A prompt with a missing argument and a resource with an unknown URI are JSON-RPC protocol errors (`-32602`). A user or the application triggers prompts and resources, so no model is waiting to read the error. The responses to ids 6 and 7 arrived before the others, so I match them by id, not by order.

### 3. A prompt is only text for the host to send

`prompts/get` returned a message and nothing else. It did not call a model or the tool. In Claude Code the host put that message into the conversation, and the model then called the tool.

### 4. Results that can be reused carry cache fields

`resources/read` and the list results have `ttlMs` and `cacheScope`. `prompts/get` (and `tools/call` results) have neither.

### 5. The prompt appears as a slash command, with my own text

The menu showed `/exchange-rate:convert-and-explain (MCP)`, my prompt description and the argument names from my `argsSchema`. I first guessed the name `/mcp__exchange-rate__convert-and-explain`, and the replies looked as if the prompt had run with that name too. I could not confirm which names Claude Code accepts.

### 6. The tool is model-triggered and user-approved

`convert 2500 USD to EUR` made the model call the tool by itself, but Claude Code asked me before running it. The approval screen shows my tool description to me too, so the description is read by the model and by the person approving. The second option allows that tool in this project without asking again.

### 7. A resource replaced four tool calls

With the table attached, the model made zero calls. In a fresh session without it, the model made four calls in parallel (PKR, JPY, EUR, GBP). It knew which currencies to ask for because my tool description lists the supported codes. I did not measure the token difference.

**My first control was contaminated.** I ran it in the same session after attaching the resource, so the table was still in the conversation history. A control experiment must start from an empty history.

### 8. The tool description is the model's only source of truth

My description said "you cannot know the current rate otherwise". The model then called made-up numbers a **live** rate and the **current market price**. After I changed the description to say the rates are a fixed demo with made-up numbers, not live market data, the answer said "This is a demo rate, not live market data." One run each, so it shows a direction, not a rule. The model's own introduction still said "current".

### 9. Claude Code seems to load the tool schema on demand

The model's first line was "I'll fetch the exchange rate tool schema", before the first call. This looks like the progressive tool discovery from Day 11 question 5, but I have not read Claude Code's docs on it.

### 10. The model did the arithmetic itself

The prompt says "use the calculator if you have one", and this server has none. The model multiplied 2,500 by 277.35 and 0.9137 correctly, but exact arithmetic belongs in a tool (Day 6).

### 11. The Inspector has a 60-second request timeout

Two requests were cancelled exactly 60 seconds after they were sent (`SdkError: Request timed out`), and their responses were logged about ten minutes later. I cannot explain the delay. Similar outliers appeared on Day 12, so I don't quote those durations.

### 12. A tool result should be rounded

`0.003294393365783306` is correct (0.9137 / 277.35) but wastes tokens and reads badly.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| The model called demo data "live" | My tool description said the rate was current | Rewrote the description to say the rates are made up |
| The first control gave the full table without a tool call | Same session, so the attached resource was still in the history | Fresh session with no `@` reference |
| The Inspector showed requests timing out | Default 60-second timeout, cause unknown | Not resolved, see "Not verified" |

## Not verified

- Which prompt names Claude Code accepts (`/exchange-rate:convert-and-explain` against `/mcp__exchange-rate__convert-and-explain`).
- The `@exchange-rate:rates://usd` format in the Claude Code docs. I used what the client showed me.
- That Claude Code loads tool schemas on demand because of progressive tool discovery.
- The token difference between attaching the resource and making four tool calls.
- Claude Desktop (I only tested Claude Code).
- Why the Inspector had two ten-minute outliers.

## What I would change

- Round the rate in the tool result, for example `Number(rate.toPrecision(6))`.
- Add a calculator tool so exact arithmetic does not depend on the model.
- Make the resource a template (`rates://{currency}`) to read the rate for one currency.
- Stop the tool description from listing codes if I want to see how the model behaves without them.

## Rules of thumb

- A tool is chosen by the model, a resource by the host or user, a prompt by the user.
- A failed prompt or resource is a protocol error. A failed tool is an `isError` result.
- The tool description is read by the model and by the person approving the call, so it must be true.
- Prefer a resource for a small table that is needed as context, and a tool for large or queried data.
- A control experiment starts from an empty history.
- Keep `claude mcp add` servers out of the repo, and remove them when done.

## Next (Day 14)

Use an MCP client from my own TypeScript agent, so the Day 7 loop gets its tools from this server instead of `tools.ts` (check the roadmap row for the exact task).
