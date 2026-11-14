# Day 14: Write an MCP client

**Week 3: MCP fundamentals**

## What I read before coding

1. The v2 TypeScript SDK client guide (`@modelcontextprotocol/client`): `Client`, `connect`, `listTools`, `callTool`.
2. The `StdioClientTransport` options (`command`, `args`, `env`, `stderr`, `cwd`) and what `close()` does.
3. The client concepts page: what a client does and what the host does.
4. The Tools page of the specification, the error section: a result with `isError` against a protocol error.
5. My own Day 7 `agent.ts`, to find where `tools.ts` is imported and used.

## Questions I answered before coding

| Question | My answer |
|---|---|
| What replaces `TOOL_DEFINITIONS` and the `switch`? | `client.listTools()` replaces the definitions and `client.callTool()` replaces `executeTool`. The agent asks the server at startup what tools exist. |
| What else changes besides the schema key? | The direction is `inputSchema` (MCP) to `input_schema` (Anthropic). Name and description pass through unchanged. Two more details: `description` is optional in MCP (`?? ""`), and the result `content` is an array that must be flattened to a string for `tool_result`. |
| Which of the three failures does the model see, and which stops the agent? | `isError: true`: the model sees it and the loop continues. An unknown tool or bad arguments: the model sees it too, because it can fix them. A dead server: the agent should stop, because the model cannot fix it. |
| Who stops the server, and what if the agent throws? | The client that started it. The spec's order is: close stdin, wait, SIGTERM, SIGKILL. With `try/finally` the cleanup runs even when the loop throws. For HTTP there is no child process, so the server's life is independent of the agent. |
| First request input tokens against Day 7? | Lower. My reason was wrong: it is lower because Day 7 defined three tools and today I define one, not because of what the question needs. |

## What I built

- `day-14/mcp-client.ts`: `connectMcp(command, args)` starts the server over stdio, connects and lists the tools. `callTool` returns `{ text, isError }`, and a thrown protocol error or a dead connection becomes `isError: true`. `close()` stops the server.
- `day-14/agent.ts`: the Day 7 loop (`MAX_STEPS = 8`, one user message with all `tool_result` blocks, `is_error`) with tools from the MCP server. The only conversion is `inputSchema` to `input_schema`. A `try/finally` closes the connection.
- `day-14/slow-server.ts`: a copy of the Day 13 server with a 90-second sleep in the tool handler, used for the timeout experiment.

```bash
npx tsx day-14/agent.ts "How many PKR is 250 EUR?"
```

## Key idea: the loop did not change, only where the tools come from

The agent loop is the Day 7 loop. The tool list comes from `tools/list` and tool calls go through `tools/call`, so any MCP server can replace `tools.ts` without changing the loop.

## Results

### Normal run: EUR to PKR

| Step | stop_reason | Input tokens | Output tokens |
|---|---|---|---|
| 1 | `tool_use` | 607 | 77 to 98 (varies per run) |
| 2 | `end_turn` | 692 to 710 | 72 to 79 |

`get_exchange_rate({"from":"EUR","to":"PKR"})` returned `303.546`, and the answer was 75,886.50 PKR.

### Input tokens against Day 7

The first request cost 607 input tokens (605 for a slightly shorter question), against 957 on Day 7. Day 7 had three tools, so the drop matches removing two tool definitions. The drop of about 350 is smaller than I expected, because the system prompt and message overhead stay. The generated schema also differs from my Day 7 one (`$schema`, no `additionalProperties: false`), so it is not an exact comparison.

### USD to INR

The model answered in one step (`end_turn`) and never called the tool. It read the supported currencies in my tool description and refused on its own. So the `isError` recovery path was not exercised.

### A server file that does not exist

`tsx` printed `ERR_MODULE_NOT_FOUND` on stderr, then `connect()` rejected with `SdkError: Connection closed`. Nothing caught it, so the process crashed with a stack trace. It failed fast and did not hang.

### Timeout: a tool that takes 90 seconds

| Step | What happened |
|---|---|
| 1 | Tool call failed after the default 60-second timeout: `MCP request failed: Request timed out` |
| 2 | The model called the same tool with the same arguments: timed out again |
| 3 | The same again |
| 4 | `end_turn`: "the exchange rate service timed out on all three attempts" |

Input tokens grew each step: 607, 707, 836, 998. With three timeouts the run took about 3 minutes (I did not time it).

In an earlier run, the late result for the abandoned request arrived at 90 seconds and the client logged `Received a response for an unknown message ID` (id 2, with the value `303.546`).

## Findings

### 1. The loop is independent of where tools live
The same loop works with tools from `tools/list`. Only the field name `inputSchema` and the result flattening needed code.

### 2. Three kinds of failure need three decisions
A tool error (`isError`) goes to the model. A thrown protocol error (unknown tool, bad arguments) also goes to the model as an error result. A dead server should stop the agent. My `callTool` wrapper turns all of them into `isError: true`, so a dead server would keep looping until `MAX_STEPS`.

### 3. A timeout abandons the request, not the work
The SDK's default request timeout is 60,000 ms. After it, the client stopped waiting, but the server kept working and sent a result at 90 seconds. The client then logged that result as an unknown message ID.

### 4. The model retries a timeout, and each retry costs time and tokens
It made the same call three times, waited 60 seconds each time, and then explained the problem to the user. The input grew each step because the history is resent (Day 7).

### 5. A timeout does not prove the call failed
The tool had succeeded on the server when the client reported an error. Retrying a timed-out call is harmless for an exchange rate and risky for a tool that sends an email or writes a record.

### 6. The tool description made the INR call unnecessary
Listing the supported codes in the description saved a tool call, as on Day 10.

### 7. A missing server file fails fast but crashes loudly
The error is clear, but the user sees a stack trace. The connect needs a `try/catch` with a short message.

### 8. Leftover test code is easy to forget
I first put the sleep in the real Day 13 server, so every run waited 60 seconds. The run only looked like a hang. Experiments belong in a copy.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| `400: messages.4: user messages must have non-empty content` | My loop did not leave after `end_turn`, so it pushed an empty `tool_result` message | Break out of the loop right after pushing the assistant message when `stop_reason !== "tool_use"` |
| Runs seemed to hang after the tool result | The 60-second sleep was in `day-13/server.ts` | Removed it and used `day-14/slow-server.ts` |
| `ERR_MODULE_NOT_FOUND` for `slow-server.ts` | `agent.ts` pointed at `day-13/` | Fixed the path |

## Not verified

- The SDK's actual shutdown sequence (I used the spec's description).
- Whether `callTool` accepts a per-call timeout option. I have not tested it.
- Why a 60,000 ms sleep against a 60,000 ms timeout succeeded once. That run was a race.
- Orphan processes: with `npx`, `transport.pid` is the pid of `npx`, not of the server. In my cloud test, killing it left the server running. I did not check this on my Mac.
- The `isError` recovery path with a real unknown currency such as AUD.
- The fatal flag for a dead server. I have not implemented it.
- The 30-tool cost estimate from Day 11. I measured one tool only.

## What I would change

- Add a `fatal` flag for a dead server so the agent stops, and decide a policy for timeouts (stop after N).
- Wrap `connectMcp` in a `try/catch` and print a short message.
- Log a timestamp per step, so a slow tool is visible.
- Use `command: "node"` with `--import tsx` so the child process is the server itself.

## Rules of thumb

- The MCP tool list replaces the hard-coded definitions, so the loop itself does not change.
- Leave the loop before building tool results, and never send an empty user message.
- A tool failure goes to the model. A dead server stops the agent.
- A timeout means "no answer", not "failed". Be careful retrying tools with side effects.
- Always close the client in `finally`.
- Put experiments in a copy, not in the file that is a deliverable.

## Next (Day 15)

Robust MCP servers: clear tool descriptions, error results against exceptions and logging, and tests, plus the week 3 review.
