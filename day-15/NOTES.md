# Day 15 notes: answers before coding

| Question | My answer |
|---|---|
| Three things in my tool description that the model reads and acts on, and what a vague description changes | What the tool does, when to use it, when not to, and what it returns. A vague description causes the wrong tool choice, under- or over-use, bad arguments and misread results. My own description still lacks "when not to use it" and what the result looks like (a number as a string, per one unit of `from`). |
| `isError` result, thrown exception or log only? | Unknown currency: `isError`, the model can retry. Empty `from`: `isError`, same reason (but the first message was empty, see the README). Upstream timeout: `isError` plus a log, with a message such as "Rate service timed out. Retry shortly." A bug in my own code: log the real error and return a generic `isError`, because the model cannot fix it. |
| A server that exits on startup: who finds out, and where does the message go? | The client that started it finds out, and the model never does. The message goes to stderr, and `connect()` fails with "Connection closed". I did not see an exit code, so I only say the connection closed. |
| Five behaviors a test must pin down | `connect()` succeeds, `tools/list` returns the expected tool, bad input returns an actionable `isError`, a timeout says retrying may help, the process exits when stdin closes and bad startup exits with a message on stderr, and stdout carries only protocol messages. In-process tests cover the first three. The last two need a spawned process. The timeout cannot be tested yet, because this server has no upstream. |
| What can a handler do about work the client abandoned? | Watch the cancellation signal (`ctx.mcpReq.signal`, an `AbortSignal`) and stop early, or pass it into whatever the handler awaits. |

## Corrections after review

- A thrown exception in a tool handler does not become a protocol error. The SDK turns it into an `isError` result with the exception's message as the text, so a bug would leak its message to the model. A `try/catch` that returns a generic error is needed.
- `z.string()` accepts `""`, so an empty `from` reaches my handler.
- A factory passed to `createMcpHandler` or `serveStdio` receives a request context as its first argument, so it cannot take its own parameters.
