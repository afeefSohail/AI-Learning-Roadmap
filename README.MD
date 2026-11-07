## Reading log (Days 0–10)

Everything I read for the roadmap so far, by day. The same links are at the bottom of each `day-NN/README.md`.

### Day 0: before the start (pre-reading)

- Andrej Karpathy, "Intro to Large Language Models" (YouTube, about 1 hour)
- Tokens and context windows; the API is stateless; max tokens and stop reasons
- Anthropic prompt engineering overview (skimmed)
- TypeScript: `async` iterators and `for await...of`, discriminated unions, JSON Schema basics (Zod to JSON Schema), server-sent events
- Optional: the Introduction page on modelcontextprotocol.io; Python basics for reading

### Week 1: LLM foundations in TypeScript

| Day | Topic | Reading |
|---|---|---|
| 1 | Setup and first LLM call | [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows), [Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| 2 | Messages, roles, settings | [Using the Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages), [System prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts), [Claude Haiku 5.5 migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide) |
| 3 | Streaming | [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| 4 | Structured output with Zod | [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Zod](https://zod.dev), [Type-safe LLM outputs with Zod](https://dev.to/thegdsks/type-safe-llm-outputs-with-zod-stop-guessing-what-the-model-returns-544e), [Instructor: reask validation](https://git.kennethreitz.org/kennethreitz/instructor/src/commit/20c50f0fe69d591fa8e64dfe05902d112b059782/docs/concepts/reask_validation.md) |
| 5 | Prompt engineering basics | [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Use examples (multishot prompting)](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting), [Use XML tags to structure your prompts](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags) |

### Week 2: Tool calling and APIs

| Day | Topic | Reading |
|---|---|---|
| 6 | Tool calling basics | [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works), [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [Tutorial: Build a tool-using agent](https://platform.claude.com/docs/en/agents-and-tools/tool-use/build-a-tool-using-agent) (skimmed) |
| 7 | Write your own agent loop | [How to implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) (parallel calls, stop reasons), [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) |
| 8 | LLM inside Express | [Express hello world](https://expressjs.com/en/starter/hello-world.html), [Routing](https://expressjs.com/en/guide/routing.html), [Express error handling](https://expressjs.com/en/guide/error-handling.html), [Using server-sent events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming) (re-read) |
| 9 | Auth and saved conversations | [Express: using middleware](https://expressjs.com/en/guide/using-middleware.html), [JWT introduction](https://jwt.io/introduction), Prisma quickstart for PostgreSQL with TypeScript (Prisma 7), [Prisma relations](https://prisma.io/docs/concepts/components/prisma-schema/relations) |
| 10 | Python reading day | [Python tutorial: virtual environments](https://docs.python.org/3/tutorial/venv.html), [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) README and `examples/tools.py`, [How to implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) (Python snippets); Pydantic and Tool Runner skimmed |