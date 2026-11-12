# Day 12: My first MCP server

**Week 3: MCP fundamentals**

## What I read before coding

1. The v2 TypeScript SDK [server guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools) (tools, input schemas, results) and [serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) (the stdio section).
2. The [`@modelcontextprotocol/server` README](https://www.npmjs.com/package/@modelcontextprotocol/server): install, the `tsconfig` note for TypeScript 6, the package layout.
3. The Tools page of the MCP specification: `tools/list`, `tools/call`, and the difference between a protocol error and a tool result with `isError: true`.
4. The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) README: launching it against a stdio server.
5. Skimmed: the v1 to v2 migration guide.

**Two SDKs exist.** The old single package `@modelcontextprotocol/sdk` is at 1.32.2. The v2 line is split into packages (`@modelcontextprotocol/server`, `client` and others, 2.4.0) and implements the 2026-07-28 spec. Most blog posts still show v1, so I used v2 and the package README.

## Questions I answered before coding

| Question | My answer |
|---|---|
| What happens if tool code does `console.log`, and where does logging go? | On stdio, stdout carries the protocol messages, so output there corrupts the stream. Logs go to stderr. |
| Who starts and stops a stdio server? | The client starts it as a child process and stops it, so the server's lifetime is tied to the client's session. |
| Who validates the input, and what does the model get back when an argument is missing? | The SDK validates against the schema before my function runs. A missing argument comes back as a normal tool result with `isError: true` and a readable message, so the model can retry (like `is_error` on Day 6). |
| Which failures are `isError` results and which are protocol errors? | Unknown currency INR: `isError` result. Missing `to`: `isError` result. Unknown tool name: protocol error, JSON-RPC `-32602` (Invalid params). The rule: if the request reached the tool, the failure is a tool result. If it cannot be handled at all, it is a protocol error. |

## What I built

- `day-12/server.ts`: a stdio MCP server with one tool, `get_exchange_rate`, using the Day 7 made-up rates. The input schema is a Zod object with `from` and `to`. An unknown currency returns an error result that lists the supported currencies.
- `day-12/probe.mjs`: a small script that starts the server and sends raw JSON-RPC messages, so I can see the wire format without the Inspector.
- `day-12/screenshots/`: Inspector screenshots and the exported protocol log (`inspector-protocol-npx-....json`), because I could not capture the `tools/list` message in a screenshot.

```bash
npm install @modelcontextprotocol/server
npx @modelcontextprotocol/inspector npx tsx day-12/server.ts
node day-12/probe.mjs
```

## Key idea: the Day 7 tool, as a server

The tool logic is the same as before. What changed is who owns it: `tools.ts` was imported into one agent, and now it is a separate program that any MCP client can start and list. `tools/list` publishes its name, description and JSON Schema, and `tools/call` runs it.

## How `probe.mjs` talks to the server

There is no network connection and no port. `probe.mjs` starts the server as a child process with `spawn`, and the `stdio` option connects the three streams:

```javascript
const p = spawn("npx", ["tsx", "day-12/server.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
  //       stdin   stdout   stderr
});
```

![How probe.mjs talks to the server over stdin, stdout and stderr](probe-diagram.png)

| Stream | Option | Meaning |
|---|---|---|
| stdin | `"pipe"` | a pipe from the probe into the server; the probe writes with `p.stdin.write(...)` |
| stdout | `"pipe"` | a pipe from the server into the probe; the probe reads with `p.stdout.on("data", ...)` |
| stderr | `"inherit"` | no pipe; the server's stderr goes straight to my terminal |

- The transport is **one JSON message per line**. The `\n` at the end tells the server the message is complete.
- `server/discover`, `tools/list` and `tools/call` are **method names** inside the JSON message. The SDK has a built-in handler for each, so my own code never reads stdin or writes stdout. `serveStdio(createServer)` does that.
- `spawn` in `probe.mjs` creates the pipes. If I run `npx tsx day-12/server.ts` by hand, the server's streams are my terminal (keyboard and screen) and no pipes exist. I run only one of the two at a time.
- This is what an MCP client does for the stdio transport. The Inspector and Claude Desktop do the same, with more features.

## Results

### In the Inspector

| Call | Result |
|---|---|
| `from: USD`, `to: PKR` | `277.35` (211 ms) |
| `from: USD`, `to: INR` | Tool Error: `Unknown currency: INR. Supported currencies: USD, PKR, EUR, GBP, JPY` (175 ms) |
| `from: USD`, no `to` | Could not send: the Inspector form requires `to`. Typing `""` sent the literal string `""` (finding 8), which my handler rejected as an unknown currency |

### With `probe.mjs` (raw JSON-RPC)

| id | Request | Response |
|---|---|---|
| 1 | `server/discover` | `supportedVersions: ["2026-07-28"]`, `capabilities: { tools: { listChanged: true } }` |
| 2 | `tools/list` | One tool with a JSON Schema generated from the Zod object |
| 3 | USD to PKR | `277.35` |
| 4 | USD to INR | `isError: true`, `Unknown currency: INR. Supported currencies: ...` |
| 5 | USD, no `to` | `isError: true`, `Input validation error: Invalid arguments for tool get_exchange_rate: to: Invalid input: expected string, received undefined` |

The server printed `exchange-rate MCP server running on stdio` and `unsupported currency requested: INR` on stderr, separate from the JSON lines on stdout.

## Findings

### 1. The same schema is checked in three places

The model reads the description and schema from `tools/list`. The Inspector form enforced `required` before sending, so I could not even submit a call without `to`. The SDK validates again on the server. When I bypassed the form with `probe.mjs`, the server still rejected the call.

### 2. A bad argument is a tool result, not a protocol error

The missing `to` came back as a normal result with `isError: true`, so the model can read the message and retry. My handler never ran for that call, so it only has to handle business failures such as an unknown currency.

### 3. Responses do not arrive in request order

The answer to `id: 5` came back before `id: 3` and `id: 4`, because the SDK rejected it before running my handler. JSON-RPC ids are how a client matches a response to its request.

### 4. The Inspector spoke the 2025 protocol; my probe spoke 2026

The exported Inspector log (client `mcp-inspector` 2.15.0, saved in `screenshots/`) opens with an `initialize` request with `protocolVersion: "2025-11-25"`. The server answers with the same version and its capabilities (`tools: { listChanged: true }`), and the client then sends `notifications/initialized`. The UI showed this as **MCP 2025-11-25** with a **LEGACY** badge. My probe skipped the handshake and sent `server/discover` with the version in `_meta`. The same server code, started through `serveStdio` with a factory, handled both.

| | Inspector (2025-11-25) | `probe.mjs` (2026-07-28) |
|---|---|---|
| Opening | `initialize`, then `notifications/initialized` | `server/discover` is optional; version and capabilities travel in `_meta` of every request |
| Request `_meta` | `progressToken` | protocol version, client info and client capabilities |
| `tools/list` response | just `tools` | also `resultType: "complete"`, `ttlMs: 0`, `cacheScope: "private"` and `serverInfo` in `_meta` |

### 5. The generated schema differs slightly from my Day 7 one

`tools/list` shows a `$schema` key and no `additionalProperties: false`. My Day 7 definition had `additionalProperties: false`. This changes the token count a little, which I have not measured.

### 6. Stderr is the log channel

The INR log line appeared on stderr, not in the JSON on stdout, so it did not break the protocol.

### 7. The Inspector asks for primitives my server does not have

After connecting, the Inspector sent `prompts/list` and `resources/list` (ids 3, 4, 6 and 7 in the export). Each got `-32601 Method not found`, because my server declares only `tools`. Here a protocol error just means "not supported". A client should check the server's capabilities before asking. Day 13 adds a resource and a prompt, so these calls should start to succeed.

### 8. Typing quotes in the form sends the quotes

To try an empty `to`, I typed `""` into the field. The request (id 10) carried `"to": "\"\""`, a string of two quote characters. My own handler rejected it: `Unknown currency: ""`. That is an `isError` result from my code, not the SDK's validation. To test a really missing argument I had to bypass the form with `probe.mjs`.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| The Inspector needs a newer Node than I had | The latest Inspector requires `^22.23.4`, `^24.22.1` or `>=26.12.1`, and I had 22.17.0 | Installed Node 24 with Homebrew (`node@24`) |
| `node -v` still showed 22.17.0 after the upgrade | The shell had remembered the old `/usr/local/bin/node` path | `hash -r`, or open a new terminal |
| `npx tsx day-09/server.ts` printed its start message and exited | Port 3001 was already used by a Docker container, and my `app.listen` callback ignored the error | Stop the container or use another port, and check the `err` argument in the `listen` callback |

## Not verified

- I did not check the Console tab in the Inspector for the stderr line.
- I did not quote the spec sentence about input validation errors being tool results. This is the behavior I observed in the SDK.
- I did not test the server with a real client other than the Inspector and my probe script.
- The Inspector showed the older protocol version. I did not find out whether it can be switched.
- Some durations in the exported log are not reliable: about 38 seconds for two `tools/list` calls and about 15 minutes for the call I cancelled. I cannot explain them, so I quote only the normal ones (tens to a few hundred milliseconds).

## What I would change

- Add `additionalProperties: false` to the input schema if the SDK allows it, to match Day 7.
- Return structured output with an `outputSchema`, not just a text string.
- Add a second tool, and a resource and a prompt (Day 13).

## Rules of thumb

- On stdio, stdout is the protocol. Everything else goes to stderr.
- The SDK validates the input, so my handler handles only business failures.
- A failure the model can fix is a tool result with `isError: true`. A request that cannot be handled is a protocol error.
- Match responses to requests by id, not by order.
- Check which spec version a tutorial or a tool is speaking.
- A newer Node on the machine affects every project, so test the others after upgrading.

## Next (Day 13)

Connect the server to Claude Desktop or Claude Code, add a resource and a prompt, and watch how the model decides to call the tool.
