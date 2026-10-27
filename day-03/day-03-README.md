# Day 03: Streaming responses

**Week 1: LLM foundations in TypeScript**

## What I built

- `stream-basics.ts`: sends the same prompt twice, once without streaming and once with streaming, prints every raw stream event, and measures time to first text and total time.
- `chat-stream.ts`: the Day 2 chat upgraded to stream replies as they arrive. Ctrl+C stops a reply, and the partial text is kept in the history.

```bash
npx tsx day-03/stream-basics.ts
npx tsx day-03/chat-stream.ts
```

How the chat works:

- `client.messages.stream(...)` returns a stream. `stream.on("text", ...)` prints each piece as it arrives.
- `await stream.finalMessage()` resolves when the reply is complete. Its `content` goes into the history and its `usage` into the cost counter.
- Ctrl+C calls `stream.abort()`, which throws `APIUserAbortError`. The code catches it and saves the partial text as the assistant message.
- Any other error removes the last user message, so the history stays valid and the chat keeps going.

## Key idea

Without streaming, the user waits for the whole reply and gets it all at once. With streaming, text arrives in small pieces while the model is still writing, so the first words show up quickly. Streaming doesn't make the total time shorter. It makes the wait feel shorter.

## Stream events

Events always arrive in this order:

```
message_start → content_block_start → content_block_delta × many → content_block_stop → message_delta → message_stop
```

- `message_start` carries the input token count.
- `content_block_delta` (with `text_delta`) carries the pieces of text.
- `message_delta` near the end carries the `stop_reason` and the final output token count.

## Experiments

### 1. First text vs full reply

| Prompt | Without streaming (total wait) | First text (streaming) | Full reply (streaming) | Chunks |
|---|---|---|---|---|
| "Explain how URLSession works in about 200 words" (301 output tokens) | 3426 ms | 2304 ms | 3922 ms | 80 |
| "Say hi in 3 words" (10 output tokens) | 1569 ms | 1062 ms | 1537 ms | 2 |

- For the long reply, the first text appeared about 1.1 s sooner than the non-streamed reply arrived. A 500-word story takes around 10 s, so the gap grows with reply length.
- For the short reply, streaming saves almost nothing (about 0.5 s).
- Streaming does not make the full reply finish sooner. These were separate requests, so the totals are noisy.
- Even a tiny prompt took over 1 s before the first text. Most of that is connection and model start-up, not generation.

### 2. Chunk size

80 chunks for 301 tokens is about 4 tokens per chunk. A chunk is a few words, not one word and not one letter.

### 3. Cancel with Ctrl+C

- I asked for a 500-word story and pressed Ctrl+C after a few words.
- I then asked "What were you just saying?" and the model quoted the kept partial text word for word. The history is the model's only memory, so whatever I save is what it knows.
- The model apologized for the "incomplete response" even though I had stopped it. It cannot know I pressed Ctrl+C. From its side it simply wrote half a sentence.
- Fix: when aborting, save the partial text with a note, like `partial + " [stopped by user]"`.

### 4. Billing on cancel

- I am still billed for the tokens generated before I stopped.
- My session cost did not include the cancelled reply, because the final token count never arrives when a stream is aborted. The total is slightly low.

### 5. Network failure

- With the connection lost during a request, the chat printed `Request failed: Connection error.` and returned to the `You:` prompt.
- The `try/catch` removed the unsent message, so the history stayed valid and the chat kept working.
- The SDK retries automatically a couple of times before giving up.

## Other findings

- Asked "What were you just saying?" with no history, the model said it had not said anything yet. It has no memory between calls.
- When I asked for a long story, the model once replied by asking whether I wanted the full 500 words instead of writing it. A clearer prompt gets a direct answer.

## Reading

- [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
