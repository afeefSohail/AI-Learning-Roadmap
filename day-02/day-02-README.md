# Day 02: Messages, roles and settings

**Week 1: LLM foundations in TypeScript**

## What I built

`chat.ts`: a terminal chat with Claude Haiku 5.5 that keeps the conversation history, uses a system prompt, and prints token usage and cost after every turn.

```bash
npx tsx day-02/chat.ts
```

How it works:

- `messages: Anthropic.MessageParam[]` holds the whole conversation.
- Each turn pushes my message, sends the **full history**, then pushes Claude's reply (`res.content`, the content blocks) back into the history.
- If a request fails, the last user message is removed so the roles keep alternating user / assistant.
- Running totals of input and output tokens are converted to cost using Haiku 5.5 prices ($0.10 / M input, $0.50 / M output).

## Key idea: the API is stateless

The model remembers nothing between calls. A chat "remembers" only because I resend the whole history every time. **The history is the model's only memory.**

## Experiments

### 1. Memory

| Setup | "What is my name?" |
|---|---|
| Full history | ✅ "Your name is Afeef." |
| Claude's replies removed, my messages kept | ✅ Still knew, because my first message was still in the history (the API joins two user messages in a row) |
| No history, only the current message | ❌ "I don't know your name or profession." |

### 2. Input tokens grow every turn

One 3-turn chat:

| Turn | Input tokens this turn | Session cost |
|---|---|---|
| 1 | 48 | $0.000033 |
| 2 | 111 | $0.000054 |
| 3 | 142 | $0.000111 |

Each turn resends everything before it, so long chats get more expensive per turn. Fixes come later: prompt caching and summarizing old history.

### 3. Output is the expensive part

That chat used 301 input and 162 output tokens. Output was about **73% of the cost**, because output tokens cost 5× more. Asking for short answers is the easiest saving. At about $0.0001 per short chat, $5 covers tens of thousands of chats.

### 4. Variety and steering

Claude Haiku 5.5 does **not** accept `temperature`, `top_p` or `top_k`. They were removed from newer models; behavior is steered with prompting instead.

Asked "Give me a name for a coffee shop" 3 times with no history:

- "Byte & Brew"
- "Bean There, Brewed That"
- "Brew & Byte"

Little variety, and the coding theme came from my system prompt ("helping an iOS developer"), not from my question. **The system prompt colors every answer, even unrelated ones.**

| System prompt addition | Results |
|---|---|
| "Always give the single most common, predictable answer" | __ |
| "Be unusual and surprising" | __ |

### 5. `max_tokens` and stop reasons

With `max_tokens: 20` the reply stopped mid-word and `stop_reason` was `max_tokens`. My code detects this and prints "(reply was cut off by max_tokens)".

### 6. The system prompt is treated as known background

Claude said "You told me you're an iOS developer", but I never said it; it came from the system prompt. The model treats the system prompt as background it already knows.

### 7. Hidden thinking tokens

One short (~40-word) reply used 199 output tokens. When thinking is on (`output_config.effort`), thinking tokens count as output and are billed, even though they are not printed.

## Errors I hit

| Error | Cause | Fix |
|---|---|---|
| `Type '"user"' is not assignable to type '"assistant"'` | Typed the array as `Anthropic.Message[]` (the **response** type, role always `assistant`) | Use `Anthropic.MessageParam[]` (the **request** type) |
| `No overload matches this call` on `temperature` | Haiku 5.5 removed sampling parameters | Delete `temperature`; steer with the system prompt |
| `404 not_found_error: model: claude-Haiku-5-5` | Model IDs are case-sensitive | `claude-haiku-5-5` |

Error codes: **401** = API key problem, **404 + model** = wrong model name, **400** = something wrong in the request.

## Reading

- [Using the Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)
- [System prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts)
- [Claude Haiku 5.5 migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
