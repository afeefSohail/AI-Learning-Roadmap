# Day 15: Robust MCP servers

**Week 3: MCP fundamentals**

## What I read before coding

1. [Test a server](https://ts.sdk.modelcontextprotocol.io/v2/testing.md) in the v2 SDK docs: in-process testing with `createMcpHandler` and `StreamableHTTPClientTransport`, the in-memory pair for 2025-era coverage, and stdio.
2. [Logging, progress, and cancellation](https://ts.sdk.modelcontextprotocol.io/v2/servers/logging-progress-cancellation.md): stderr for logs, protocol log notifications (deprecated in 2026-07-28), and `ctx.mcpReq.signal` for cancellation.
3. [Server errors](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html) again: a tool error is an `isError` result, a protocol error is never seen by the model, and a throwing tool handler becomes an `isError` result.
4. My Day 12 to 14 READMEs, for the week 3 review.

**Questions I answered before coding:** see `NOTES.md`.

## What I built

- `day-15/create-server.ts`: the Day 13 server, split out so tests can import it. `createServer()` takes no arguments, and `buildServer(deps)` takes an injectable rate lookup. Changes: input trimmed, a check for 3-letter codes, rates rounded to 6 significant digits, and a `try/catch` around the lookup.
- `day-15/server.ts`: the stdio entry (`serveStdio(createServer)`).
- `day-15/server.test.ts`: 15 in-process tests using `node:test`. No port and no child process.
- `day-15/stdio.test.ts`: 3 tests that spawn the real `server.ts`.
- `day-15/cancel.ts`: a small experiment on cancellation.
- `tsconfig.json` in the repo root, with `types: ["node"]` and `allowImportingTsExtensions`.

```bash
node --import tsx --test day-15/server.test.ts
node --import tsx --test day-15/stdio.test.ts
npx tsx day-15/cancel.ts
npx tsc --noEmit
```

## Key idea: a server is only robust if its failures are tested

The Day 12 to 14 servers worked when I tried them by hand. Tests make each failure path repeatable: bad input, a bug, a bad startup, stray output.

## Results

### In-process tests (15)

| Area | What is pinned down |
|---|---|
| Tool list | One tool, and the description says DEMO and "not live market data" and lists every code |
| Results | `277.35` for USD to PKR, `303.546` for EUR to PKR (rounded), `196.343` for GBP to JPY, `1` for USD to USD, lowercase and spaces accepted |
| Bad input | INR: `isError` that lists the supported codes. Empty `from`: `isError` that says "3-letter codes". A missing `to`: `isError` from the SDK validation |
| A bug in the tool | `isError` with a generic message that does not contain the internal message. The stack trace goes to stderr |
| Protocol errors | An unknown tool name rejects. An unknown resource rejects. A prompt with a missing argument rejects |
| Resource and prompt | `rates://usd` returns the table. The prompt fills in its arguments |

### Spawned-process tests (3)

| Test | Result |
|---|---|
| Start the real server, list the tool, call it | Passed, `277.35` |
| Close stdin | The server exited by itself with code 0 |
| Stdout hygiene | Every line on stdout parsed as JSON-RPC |

**Mutation check for stdout:** I added `console.log("hello")` to `server.ts`. The stdout test failed with `"hello" is not valid JSON`. The first test, using the real client, still passed.

### Cancellation experiment

The handler sleeps 5 seconds and watches `ctx.mcpReq.signal`. The client calls it with `{ timeout: 1000 }`:

```
[server] started
[client] after 1003 ms: Request timed out
[server] aborted: AbortError
[end]
```

## Findings

### 1. The first message for an empty `from` was useless
`z.string()` accepts `""`, so my handler answered `Unknown currency: .` with an empty code. The failing test came first, then the fix: a 3-letter code check with a message that says what to send.

### 2. A throwing handler leaks its message
The errors page says an exception from a tool handler becomes an `isError` result with the exception's message as the text. A bug in my code would show internals to the model. The `try/catch` returns a generic message and logs the real error to stderr.

### 3. The factory gets a request context
`createMcpHandler(createServer)` and `serveStdio(createServer)` call the factory with a context argument. My first attempt, `createServer(deps = defaultDeps)`, received the context in `deps`, and every call failed with the generic error. The fix: `createServer()` takes nothing and calls `buildServer(deps)`.

### 4. The real client ignores stray stdout lines
With `console.log("hello")` in the server, the client test still passed. Only the explicit stdout test caught it. I had expected the client to fail.

### 5. A test can pin a phrase too tightly
My first fix said `3 letters` and the test looked for `3-letter`. I kept the strict test, because a failing test tells me that model-facing text changed.

### 6. Closing stdin ends the server
Exit code 0, about 1.5 seconds including startup. The in-process tests cannot show this.

### 7. A client timeout can abort the handler
In-process, the signal fired when the client gave up, and the handler stopped before finishing. On Day 14 the server kept working and answered at 90 seconds. That handler did not watch the signal, and that run used stdio.

### 8. A per-call timeout exists
`callTool` takes a second argument with `timeout` and `signal`. I used `{ timeout: 1000 }`.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| Editor: `Cannot find name 'node:assert/strict'` | No `@types/node` in `types` | Installed `@types/node` and created `tsconfig.json` |
| `tsc`: `TS5097` for `.ts` imports | `allowImportingTsExtensions` missing | Added it to `tsconfig.json` |
| Tests still showed 11 after adding mine | The file was not saved | Saved and reran |
| The empty-`from` test still failed after the fix | The message said `3 letters`, the test `3-letter` | Changed the message |
| All tool calls returned the generic error | The factory received a context as `deps` | Split into `createServer()` and `buildServer(deps)` |

## Not verified

- The mutation check for the `try/catch` (delete it and confirm the leak test fails). I did not report the result.
- Whether the stdio client also cancels the request on timeout. My cancellation run used the in-process HTTP transport.
- The variant of the cancellation experiment without the signal.
- A timeout from an upstream API, because this server has none.
- Logging to protocol notifications (`ctx.mcpReq.log`). I only used stderr.
- Progress notifications.

## What I would change

- Add "when not to use it" and the result format to the tool description, and compare the first-request token count.
- Add a `fatal` flag in my Day 14 client, so a dead server stops the agent.
- Decide a retry policy for timeouts. Day 14 showed three identical retries.
- Add a fake upstream so a timeout path can be tested.

## Rules of thumb

- Write the failing test first, then fix.
- A throwing tool handler leaks its message. Catch it, log it, return a generic error.
- In-process tests cover logic. A spawned process covers startup, shutdown and stdout.
- A test that has never failed has not been shown to work. Delete the fix once and watch it fail.
- The SDK calls a server factory with a context. Keep the factory argument-free.
- Watch the cancellation signal in long handlers.

## Next

Day 16 (Monday 16 November, week 4): design the UserAuth MCP server, listing the tools (`get_profile`, `list_photos`, `get_photo`, `upload_photo`, `delete_photo`) and deciding how the server gets the user's token, in a README before any code.
