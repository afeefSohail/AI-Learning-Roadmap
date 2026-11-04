# Day 08: LLM inside Express

**Week 2: Tool calling and APIs**

## What I read before coding

1. [Express hello world](https://expressjs.com/en/starter/hello-world.html) and [Routing](https://expressjs.com/en/guide/routing.html): `express.json()` fills `req.body`; a `POST` handler uses `res.json` and `res.status`.
2. [Express error handling](https://expressjs.com/en/guide/error-handling.html): in Express 5 a rejected promise or a thrown error in an `async` handler goes to the error handler automatically. The four-argument `(err, req, res, next)` function is the error handler.
3. [Using server-sent events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events): the headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`), the message format (`data:` lines ending with a blank line, optional `event:` names), and that `EventSource` only supports `GET`, so a `POST` endpoint is read with `fetch` or `curl -N`.
4. [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming), re-read: `stream.on("text", ...)` and `finalMessage()`.

**Questions I answered before coding:** where the history lives, which status codes to use, what happens when the client disconnects, who may set the model and system prompt, and how to report an error after the stream has started. The answers are in "Design decisions" below.

## What I built

- `server.ts`: an Express 5 server with `POST /chat` (streams the reply as server-sent events) and `GET /health`.
- `public/index.html`: a small chat page that sends the whole conversation to `/chat` and shows the reply as it streams in.

```bash
npx tsx day-08/server.ts
curl -N -X POST localhost:3000/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"Say hi in 3 words"}]}'
# or open http://localhost:3000
```

## Key idea: the server owns the rules, the client owns the history

- The **client** sends the whole `messages` array on every request. The server stores nothing (Day 9 changes that).
- The **server** owns everything that costs money or changes behavior: the API key, the model, `max_tokens` and the system prompt. The client may send `messages` and nothing else.

## How `POST /chat` works

1. `express.json({ limit: "50kb" })` parses the body.
2. Zod validates it with `.strict()`: 1 to 30 messages, each `user` or `assistant`, 1 to 4000 characters, last message from the user. Any problem returns 400 with the list of issues.
3. `client.messages.stream(...)` starts the model call with the server's own model, system prompt and `max_tokens`.
4. `res.on("close")` aborts the model stream if the client left before the response finished (`!res.writableFinished`).
5. The SSE headers are sent when the first text arrives. Each text piece goes out as `event: text`, and the end as `event: done` with the stop reason, token counts and cost.
6. If the model call fails before any text, the client gets a real HTTP error (502, or 504 on timeout). If it fails after the headers are sent, the server writes `event: error` and ends the response.

## Design decisions

| Question | Decision |
|---|---|
| Where does the history live? | On the client. `POST /chat` carries the full `messages` array. Storage and a conversation id come on Day 9. |
| Status codes | 400: the client sent a bad request. 500: a bug in my code. 502: the model API failed or returned something bad. 504: the model API timed out. |
| Client disconnects mid-stream | Abort on `res` close, and check `res.writableFinished` because `close` also fires on a normal finish. `req` close is not a disconnect signal: it fires once the body has been read. |
| What may the client send? | Only `messages`. `.strict()` rejects `model`, `system` and anything else, so nobody can pick an expensive model or replace my system prompt. Length and count limits cap what one request can cost. |
| Error after the stream started | The status is already 200 and cannot change. Send a short generic `event: error` and end the stream. The full error stays in the server log. |

## Results

### Validation (all return 400)

| Request | Response |
|---|---|
| No `messages` field (`role`/`content` at the top level) | `messages` missing, and `role`, `content` unrecognized |
| Extra field `model` | `Unrecognized key: "model"` |
| Empty `content` (also with `model`) | `messages.0.content` too small, and `model` unrecognized |
| Last message from the assistant | `The last message must be from the user.` |
| 31 messages | `Too big: expected array to have <=30 items` |
| Invalid JSON (`{oops`) | `bad_request`, with a generic message from the error handler |

Zod reports every problem in one response.

### Cost per request

| Prompt | Input | Output | Cost |
|---|---|---|---|
| "Say hi in 3 words" | 38 | 10 | $0.0000088 |
| "Write a 400 word story" (run 1) | 37 | 902 | $0.000455 |
| Same prompt (run 2) | 37 | 907 | $0.000457 |
| Same prompt (run 3) | 37 | 771 | $0.000389 |
| Second chat turn in the browser (3 messages in the history) | 73 | 15 | $0.000015 |

### `curl -N` or not (timestamps of the SSE events)

| | With `-N` | Without `-N` |
|---|---|---|
| Arrival times | spread over at least 2 seconds, in small bursts | every event within about 0.01 s |

### Bad API key

- The client got `502` with `{"error":"upstream_error","message":"The model request failed."}`.
- The server log got the full `AuthenticationError: 401 ... Invalid bearer token` with the request id.

## Findings

### 1. The long reply cost about 52 times the short one

Input stayed the same (37 against 38 tokens) and output grew about 90 times (10 to 902), so output was about 99% of the cost. The short reply used only 10 output tokens, which means little hidden thinking on that prompt. 902 tokens is more than a 400-word story needs, so either thinking or a longer story filled the rest. I did not count the words.

### 2. The same prompt gave a different cost every time

Three runs of the story prompt used 902, 907 and 771 output tokens, about 15% apart. One measurement is an estimate.

### 3. Streaming looked broken without `-N`, but the server was fine

Without `-N`, curl buffers when it writes to a pipe, so all the events appeared at once at the end. With `-N` they arrived over several seconds in small bursts. The server streamed in both cases. A reverse proxy in front of a server can buffer the same way, so test streaming with `-N`.

### 4. The history is just the client resending itself

DevTools showed the second request body with three messages: user ("My name is Afeef"), assistant (the greeting) and user ("What is my name?"). The server remembers nothing. That is the Day 2 lesson again, now through my own API. It also means the client could send a made-up assistant message, which is fine for a toy and not for a real product.

### 5. The client never sees why the model call failed

With a bad key, the client saw a generic 502 and the log showed the real cause. A 401 from Anthropic means my server is misconfigured, not that the client did something wrong, so it is not passed on as a 401.

### 6. `.strict()` turned a rule into something enforced

A client trying to send its own `model` gets a 400 instead of silently being ignored.

## Mistakes and fixes

| Problem | Cause | Fix |
|---|---|---|
| Tried `res.on("done", ...)` to abort the stream | `done` is the name of my SSE event, not an event on the Node response, so it never fires | Use `res.on("close")` and check `!res.writableFinished` |
| Streaming test showed no streaming | curl buffers without `-N` | Use `curl -N` |
| Short-reply cost in the log: `$0.000009` vs `0.0000088` in the `done` event | `toFixed(6)` rounds small costs | Use more decimals in the log |

## Not tested yet

- The `event: error` path when the model fails after the stream has started.
- Closing the browser tab as a disconnect (I tested Ctrl+C in curl; the log showed `client disconnected, aborting the model stream`).

## What I would change

- Log only the status and the request id of an upstream error instead of the whole error object with headers.
- Round the cost on the server (`Number(cost.toFixed(7))`) so the client does not get `0.00045469999999999994`.
- Add `app.disable("x-powered-by")`.
- An aborted request prints no cost line, because the final usage never arrives, but the tokens are still billed. The server log is slightly low.
- Add real storage and a conversation id (Day 9), plus authentication and rate limiting before this is on the internet.

## Rules of thumb

- The server decides the model, system prompt and `max_tokens`. Reject everything else with `.strict()`.
- 400 means the client's fault, 502 means the upstream's fault, 500 means mine.
- Once SSE headers are sent, errors travel inside the stream.
- Abort the model call when the client leaves, and check `writableFinished`.
- Test streaming with `curl -N`.
- Never send raw errors to the client.

## Next (Day 9)

Authentication and saved conversations: a user logs in, `/chat` takes a conversation id, and the history is stored on the server.
