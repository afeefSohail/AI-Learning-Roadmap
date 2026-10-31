# Week 1 notes: LLM foundations in TypeScript (Days 1–5)

## What I can do now

- Call Claude from TypeScript with the Anthropic SDK, and read the response blocks, `stop_reason` and `usage`.
- Keep a conversation going by managing the message history myself, stream replies, and cancel one midway.
- Get validated JSON from the model: JSON Schema from Zod, `safeParse`, and a repair loop that sends errors back.
- Compare prompt styles with real numbers instead of impressions.

## Facts to remember

### The API
- It is **stateless**. The history I send is the model's only memory.
- The system prompt goes in the top-level `system` field. `messages` holds only `user` and `assistant` turns.
- The reply is an **array of content blocks**. Check `block.type`, because tool calls will show up here too.
- `stop_reason`: `end_turn` is a finished reply, `max_tokens` means it was cut off, `refusal` means the output may not match the schema. Check it before parsing.
- Model IDs are lowercase and case-sensitive: `claude-haiku-5-5`.
- Claude Haiku 5.5 does not accept `temperature`, `top_p` or `top_k`. Steer behavior with the prompt.
- Error codes: 400 = problem in the request, 401 = API key, 404 on `model` = wrong model name.

### Tokens and cost
- Haiku 5.5: $0.10 per million input tokens, $0.50 per million output tokens (prompts up to 100K). Output costs 5× more.
- Every turn resends the whole history, so input tokens grow turn by turn.
- Output tokens include hidden thinking. A one-word reply used 154–197 output tokens on an ambiguous input.
- Asking for short, labeled replies is the cheapest optimization: in Day 5, `plain` cost 11× more per call than a one-line prompt with labels.

### Streaming
- Events arrive in this order: `message_start`, `content_block_start`, `content_block_delta` (many), `content_block_stop`, `message_delta`, `message_stop`.
- Streaming shows the first text sooner but does not finish sooner, and it barely helps for short replies.
- Cancelling throws `APIUserAbortError`. Keep the partial text in the history with a note like `[stopped by user]`, or the model will apologize for an "incomplete" answer. Cancelled replies are still billed.

### Structured output
- Pass the schema in `output_config.format` (`json_schema`). Zod 4 builds it with `z.toJSONSchema`.
- The API schema does not support `minimum`, `maximum`, `minLength` and similar. Use `.refine` for those rules and let Zod check them after the reply.
- Schema mode adds a fixed number of input tokens per schema (228–252 here), and the amount grows with the schema.
- The schema makes the **shape** reliable. Zod checks the **rules**. The repair loop connects them.
- A valid shape is not a correct answer, and a repair satisfies the validator, not necessarily the truth.

### Prompts
- A prompt is a spec. If I don't list the labels or the format, the model decides for me.
- Rules settle ambiguous cases. Examples show judgment but cost tokens on every call.
- Define what "correct" means before running a test, and don't change it afterwards.

## Mistakes I made this week

| Day | Mistake | Lesson |
|---|---|---|
| 1 | `system` role inside `messages` | Anthropic uses a top-level `system` field |
| 2 | Typed the history as `Message` | Requests use `MessageParam`, responses use `Message` |
| 2 | `temperature` on Haiku 5.5 | Check the model's docs before copying parameters |
| 2 | `claude-Haiku-5-5` | Model IDs are lowercase |
| 4 | `z.number().int()` in the API schema | Zod's `.int()` becomes `minimum`/`maximum`, which the API rejects |
| 4 | Inverted `stop_reason` check | `end_turn` is the good case |
| 4 | `useSchema: true` hard-coded | Print the thing you think you're testing |
| 5 | Loop variable named `case` | Reserved word; the other errors were side effects |

## Carry into Week 2

- Tool calling uses the same content blocks, so keep saving `res.content` into the history.
- An agent loop is the Day 2 chat loop plus tools.
- Keep checking `stop_reason` and logging token usage.
- Keep saving raw results to JSON so I can analyze them later without paying again.

## Open questions

- Does prompt caching (Week 7) make long prompts cheap enough to use few-shot examples freely?
- How much do hidden thinking tokens cost on average, and can an `effort` setting control them?
- Is "Will you ever support Apple Watch?" a `general_question` or a `feature_request`? Decide, then teach it with a rule or an example.
