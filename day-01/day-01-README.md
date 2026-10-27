# Day 01: Setup and first LLM call

**Week 1: LLM foundations in TypeScript**

## What I built

- `hello-llm.ts`: sends one message to Claude Haiku 5.5 with the Anthropic TypeScript SDK and prints the reply, the stop reason and the token usage.
- A token-counting check with `client.messages.countTokens()` to measure input tokens before sending a request.

```bash
npx tsx day-01/hello-llm.ts
```

## Setup

- Node + TypeScript project at the repo root, shared by all days (`"type": "module"` for top-level `await`)
- Packages: `@anthropic-ai/sdk`, `dotenv`, `tsx`, `typescript`
- API key in `.env` (git-ignored), read automatically by the SDK from `ANTHROPIC_API_KEY`
- API key created with a custom expiry and a monthly spend limit set in the Console

## What I learned

- **The reply is a list of content blocks, not a string.** `response.content` is an array; today it holds one `text` block. Later it will also hold `tool_use` blocks, so I loop and check `block.type`.
- **`usage` is the bill.** Every response reports `input_tokens` and `output_tokens`, and that is exactly what is charged.
- **`stop_reason`** is `end_turn` when the model finishes on its own, and `max_tokens` when my limit cuts it off. Setting `max_tokens: 10` cut the reply mid-sentence.
- **Tokens are not words.** English text, code and Urdu text produce different token counts for similar lengths.
- **Context window:** the whole request (system prompt + all messages + the reply) has to fit inside the model's context window.
- **Pricing:** Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens (prompts up to 100K tokens). Output is 5× the price of input.

## Token counts

| Text | Input tokens |
|---|---|
| Short English sentence | __ |
| Block of code | __ |
| Urdu text | __ |

My first call cost about $__ (__ input + __ output tokens).

## Error I hit

```
messages.0: use the top-level 'system' parameter for the initial system prompt
```

I put `{ role: "system", ... }` inside the `messages` array (the OpenAI style). In the Anthropic API the system prompt is a separate top-level `system` field, and `messages` holds only `user` and `assistant` turns.

## Reading

- [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)
- [Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
