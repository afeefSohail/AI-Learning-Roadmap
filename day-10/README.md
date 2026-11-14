# Day 10: Python reading day

**Week 2: Tool calling and APIs**

## What I read before coding

1. [Python tutorial: virtual environments and packages](https://docs.python.org/3/tutorial/venv.html): why a project gets its own `.venv`, activating it, and installing with `pip`.
2. [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) README: the sync client `anthropic.Anthropic()`, `client.messages.create(...)` with keyword arguments, and the API key coming from `ANTHROPIC_API_KEY`.
3. The tool-use example in that repo (`examples/tools.py`) and the Python snippets in [How to implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use): the same `tool_use` and `tool_result` blocks as in TypeScript, as dictionaries.
4. Optional, skimmed: Pydantic (the Python counterpart of Zod) and the SDK's Tool Runner, which runs the loop for you. I wrote the loop by hand again so I could compare it with Day 7.

**Questions I answered before coding:** what changes between the SDKs, and what I expected to differ (number printing, time formatting, JSON output, schema validation). The results are in `NOTES.md`.

## What I built

- `day-10/agent_loop.py`: `run_agent(question, max_steps)`, a port of `day-07/agent.ts`. Three tools (`calculator`, `get_current_time`, `get_exchange_rate`), handwritten tool definitions, `execute_tool` that returns `(content, is_error)`, a result dataclass, and a command line entry.
- `day-10/NOTES.md`: the TypeScript against Python differences.
- `day-10/week-02-notes.md`: the week 2 review.

```bash
python3.13 -m venv day-10/.venv
source day-10/.venv/bin/activate
pip install anthropic
python day-10/agent_loop.py "your question"
MAX_STEPS=2 python day-10/agent_loop.py
```

## Key idea: the loop does not depend on the language

The API is the same JSON over HTTP. The loop is the same too: call the model, stop unless `stop_reason` is `tool_use`, push the assistant's whole content, run every tool, send all results in one user message, stop at a step limit. Only the surrounding details change.

## Results

| Run | Steps | Tool calls | Tokens in / out | Cost |
|---|---|---|---|---|
| Default question | 5 | 4 | 6,120 / 534 | $0.000879 |
| Time in Tokyo | 2 | 1 | 2,042 / 96 | $0.000252 |
| Capital of France | 1 | 0 | 969 / 12 | $0.000103 |
| Default with `MAX_STEPS=2` | 2 (limit) | 2 | 2,111 / 214 | $0.000318 |
| 100 USD to INR (list in the description) | 1 | 0 | 972 / 355 | $0.000275 |
| 100 USD to INR (list removed) | 2 | 1 | 2,017 / 219 | $0.000311 |
| Tokyo + London + 2480 / 8 | 2 | 3 | 2,327 / 282 | $0.000374 |
| Atlantis | 1 | 0 | 972 / 237 | $0.000216 |

The default answer matched Day 7: 818,182.50.

## Findings

### 1. The Python loop behaves like the TypeScript one

Same steps, same tool calls, same answer, and token counts within about 1% (6,120 against 6,045 input). The differences are noise from the model plus one real cause, below.

### 2. The first request was 12 tokens bigger, and I could explain it

Step 1 was 992 against 980 on the default question, and 969 against 957 on the France question. The same +12 on both meant the fixed part was different. A `diff` of the two serialized tool definitions showed only the parameter names (`from_currency` and `to_currency` in Python against `from` and `to` in TypeScript). Renaming them back gave 957, exactly the TS number. Parameter names are part of the prompt I pay for on every request.

### 3. Zod's schema and my handwritten one were identical

Apart from the two names, the JSON was the same, including `additionalProperties: false`. Writing it by hand worked, but Python has no tool that makes the schema and the validation come from one definition (Pydantic is the option to look at later).

### 4. Input still grows by the previous step's output

Input per step: 992, 1,082, 1,245, 1,349, 1,452. Growth was 90, 163, 104 and 103 against outputs of 82, 156, 95 and 94. Same as Day 7.

### 5. Removing one sentence from the description costs 27 tokens per request

Step 1 input was 972 with the supported currencies in the description and 945 without. With the list, the model refused INR at once. Without it, it called the tool, got `Unknown currency: INR. Supported currencies: USD, PKR, EUR, GBP, JPY`, and explained that. The error path cost about 13% more ($0.000311 against $0.000275). The error message listing the supported currencies is what let it recover.

### 6. The model did not call the tool for Atlantis

I wanted to see the invalid time zone error, but the model recognised that Atlantis is mythical and answered directly. I called `execute_tool` directly instead. Python returned my own message `Invalid timezone: Asia/Atlantis` with the error flag, and Node's `Intl.DateTimeFormat` throws `RangeError: Invalid time zone specified: Asia/Atlantis`.

### 7. Parallel calls work the same

Tokyo, London and 2480 / 8 went out as three tool calls in one step and finished in 2 steps. The times were right (05:29 JST and 20:29 GMT when my clock said 01:29).

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| `python3 --version` still showed 3.9.6 after `brew install python@3.13` | The Homebrew install does not replace the system `python3` | Create the venv with `python3.13` |
| `ModuleNotFoundError: No module named 'dataClasses'` | Typo in the module name; Python is case-sensitive | `from dataclasses import dataclass` |
| `Anthropic.__init__() takes 1 positional argument but 2 were given` | I passed the key positionally | `anthropic.Anthropic()` or `api_key=...` |
| `Could not resolve authentication method` | `ANTHROPIC_API_KEY` was not set in the terminal, and Python does not read `.env` by itself | Export the key, or use `python-dotenv` |

## Not tested

- The async client (`AsyncAnthropic`).
- Streaming in Python.
- The SDK's Tool Runner.
- Pydantic for schemas.
- A missing argument from the model (the `TypeError` path).

## What I would change

- Use explicit parameters on `get_exchange_rate` instead of `**kwargs`, so a missing argument gives a readable `TypeError`.
- When the step limit is hit, make one last request without tools that asks the model to summarise what it found (the Day 7 idea).
- Add the run id, timing and a running cost to the per-step log.

## Rules of thumb

- A loop port should be line for line. If the behaviour differs, find the one cause.
- Tool names, parameter names and descriptions cost input tokens on every request.
- Test an error path by calling the tool directly when the model will not trigger it.
- Python checks fewer things before the code runs, so run it often.
- Keep `.venv/` and `.env` out of git.

## Next (Day 11)

Week 3, MCP fundamentals, starting Monday 9 November.
