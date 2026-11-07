# Week 2 review: Tool calling and APIs (Days 6 to 10)

## What I built

| Day | Built | One-line lesson |
|---|---|---|
| 6 | `calculator` and `get_current_time`, one tool round trip | The model asks, my code runs |
| 7 | An agent loop with a step limit, parallel calls and a third tool | An agent is a loop with three exits |
| 8 | An Express 5 server streaming the reply over SSE | The server owns the model, the system prompt and the key |
| 9 | JWT auth with UserAuth tokens, Prisma and Postgres conversations | Identity comes from a verified token and every query filters by owner |
| 10 | The Day 7 loop in Python | The loop does not depend on the language |

## The numbers I should remember

- Two small tools add about 626 input tokens to every request, and three tools plus the system prompt about 957, even when the model calls nothing.
- In a 5-step run about 79% of the input tokens were the repeated fixed part.
- Input grows by roughly the previous step's output (hidden thinking included) per step.
- Output tokens are what cost money: a 10-token reply against a 902-token reply was about 52 times the cost.
- Renaming two parameters moved the first request by exactly 12 tokens.
- One description sentence (the supported currencies) cost 27 tokens per request and saved about 13% on a bad request.

## What I understand now that I did not on Day 6

1. **Tool use is a protocol, not magic.** `tool_use` blocks come back, I send `tool_result` blocks in one user message with matching ids, and `stop_reason` tells me whether to go round again.
2. **Every exit of the loop needs a decision.** Success, a non-`end_turn` stop and the step limit are different outcomes, and the step limit protects my wallet more than the user.
3. **Tool design decides the cost.** A calculator that takes two numbers made `5+5+5+5+5` take 5 steps. Descriptions prevent wasted calls and error messages let the model recover.
4. **The server owns the rules.** Model, system prompt and `max_tokens` belong to the server (`.strict()`), and errors map to status codes: 400 the client, 502 the upstream, 500 mine.
5. **Streaming needs care at the edges.** Abort the model call when the client leaves (`res.on("close")` plus `!res.writableFinished`), and once headers are sent, errors travel inside the stream.
6. **Auth is mostly about who the user is and what they own.** Verify the algorithm, take the user id from the token, and answer "not yours" and "does not exist" with the same 404.
7. **My tests lie unless I check them.** The "second account" was the same user, and the tokens had expired. Decode the token and read the real error.
8. **Python is the same API.** A different language changes the details around the loop, not the loop.

## Mistakes worth remembering

| Mistake | Lesson |
|---|---|
| Tools never reached the API (16 to 29 input tokens) | When nothing happens, read the token counts first |
| Totals added input and output together | Accumulate separately and check against a hand calculation |
| `res.on("done")` is not a Node event | Use `close` and `writableFinished` |
| Curl without `-N` looked like no streaming | Test streaming with `-N` |
| Wrong env var name made every token invalid | Log the real verification error, not a generic one |
| Pasted tokens and secrets into chat | Never paste them, rotate any that were |
| Typo `dataClasses` | Python finds spelling errors only when the line runs |

## Not tested this week

- The `event: error` path after a stream has started.
- Two requests at once in the same conversation.
- Pagination of the conversation list.
- Python streaming, the async client, Tool Runner and Pydantic.

## What I would improve first

1. A final summarising request when the step limit is hit.
2. A real log per step: run id, timing, cache tokens, running cost.
3. Rate limiting and conversation rename and delete.
4. RS256 and a token-type claim in UserAuth.

## Looking ahead

Week 3 (from Monday 9 November) is MCP fundamentals: the protocol a tool server and a client speak, so tools I write once can be used by any client. Today's loop already has the hard part. I know what a tool call looks like on the wire, what it costs, and how it fails.
