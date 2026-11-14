# Week 3 review: MCP fundamentals (Days 11 to 15)

## What I built

| Day | Built | One-line lesson |
|---|---|---|
| 11 | Notes and an architecture diagram, no code | The model never talks to the server: the host talks to the model and the client talks to the server |
| 12 | A stdio MCP server with one tool, and a raw JSON-RPC probe | On stdio, stdout is the protocol and logs go to stderr |
| 13 | A resource and a prompt, tested in the Inspector and Claude Code | A tool is chosen by the model, a resource by the host, a prompt by the user |
| 14 | An MCP client and the Day 7 agent loop using MCP tools | The loop did not change, only where the tools come from |
| 15 | A testable server and 18 tests | A bug is logged and answered generically, and tests pin down model-facing text |

## The numbers I should remember

- The first request had 607 input tokens with one MCP tool, against 957 on Day 7 with three tools and the system prompt.
- The default MCP request timeout is 60,000 ms. Three timed-out retries made input grow from 607 to 998 tokens and took about 3 minutes.
- A tool definition costs roughly 150 to 300 tokens in every request. This is an estimate, and I never measured 30 tools.
- Day 7 tool definitions came to 957 tokens including the system prompt. MCP's generated schema adds `$schema` and drops `additionalProperties: false`.
- 15 in-process tests and 3 spawned-process tests, all passing.

## What I understand now that I did not on Day 11

1. **MCP moves tools out of the agent.** The agent is the host and creates one client per server. The loop stays the same.
2. **Three primitives, three triggers.** The model proposes tools, the host or user attaches resources, and the user picks prompts.
3. **Failures have different channels.** A tool failure is an `isError` result. A bad prompt argument or an unknown resource is a protocol error (`-32602`). An unknown tool name makes `callTool` throw.
4. **The tool description is the model's only truth.** The "live" mislabel on Day 13 came from my own wording.
5. **A timeout is not a failure.** The server finished the work at 90 seconds after the client had given up, and the model retried three times.
6. **A thrown exception in a tool handler becomes an `isError` with its raw message.** A bug needs a `try/catch` so internals do not reach the model.
7. **Make the server testable.** A factory with no arguments lets tests run it in-process, and only startup, shutdown and stdout need a child process.
8. **Check which protocol version a tutorial speaks.** The Inspector used 2025-11-25, my probe used 2026-07-28, and the same server handled both.

## Mistakes worth remembering

| Mistake | Lesson |
|---|---|
| Named VS Code as the MCP host (Day 11) | The host is the AI application that runs the model and creates the clients |
| Wrote that the server "decrypts" a JWT (Day 11) | A JWT is signed, not encrypted: verify the signature |
| Expected a missing argument to be a protocol error (Day 12) | The SDK returns an `isError` result, and the unknown tool name is `-32602` |
| Guessed the slash command name (Day 13) | Read the menu the client shows |
| A control experiment in the same session (Day 13) | A control starts from an empty history |
| The description said the rate was current (Day 13) | The model repeated it, so the description must be true |
| No break after `end_turn` gave an empty `tool_result` (Day 14) | Leave the loop before building tool results |
| Left a 60-second sleep in a deliverable file (Day 14) | Experiments belong in a copy |
| Wrote the `inputSchema` arrow backwards (Day 14) | The MCP field is `inputSchema` and Anthropic's is `input_schema` |
| Message said "3 letters", test expected "3-letter" (Day 15) | Tests pin down wording |
| Gave the server factory an argument (Day 15) | The SDK passes a request context to the factory |

## Not tested this week

- Streamable HTTP over a real network, and authentication (OAuth).
- A `fatal` flag so the agent stops on a dead server.
- Whether the stdio client sends a cancellation on timeout.
- The Day 11 claim about progressive tool discovery, which I never quoted from the page.
- The cost of 30 tools, Claude Desktop, and whether the `try/catch` test fails without the `try/catch`.

## What I would improve first

1. A typed check for a dead server in the client, and a per-call timeout in the agent.
2. "When not to use" and a result description in the tool description, with a token comparison.
3. A calculator tool, so exact arithmetic does not depend on the model.
4. A server that talks to a real upstream, so timeout and retry policy can be tested.

## Looking ahead

Week 4 starts on Monday 16 November with the design of the UserAuth MCP server. Today's agent already has the hard part: it gets tools from any MCP server, it handles tool failures, and I know how a server should be tested.
