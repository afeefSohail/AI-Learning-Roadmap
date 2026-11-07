# Day 10 notes: TypeScript vs Python

The Day 7 agent loop (`day-07/agent.ts`) rewritten in Python (`day-10/agent_loop.py`). Same model, same system prompt, same three tools, same loop. These are the differences I actually saw.

## Same behaviour

| Run | TS (Day 7) | Python (Day 10) |
|---|---|---|
| Default question (2500 USD to PKR + 18%) | 5 steps, 4 calls, 6,045 in / 523 out | 5 steps, 4 calls, 6,120 in / 534 out |
| `MAX_STEPS=2` | 2,088 / 215, step limit | 2,111 / 214, step limit |
| Tokyo + London + 2480 / 8 | 3 calls in one step, 2,309 / 299 | 3 calls in one step, 2,327 / 282 |
| 100 USD to INR, list in description | 960 / 321, no tool call | 972 / 355, no tool call |
| 100 USD to INR, list removed | 2 steps, 1,985 / 254 | 2 steps, 2,017 / 219, recovered from the error |
| Capital of France | 957 in | 957 in (after the rename test below) |

The answer to the default question was identical (818,182.50). Output tokens differ by a few tokens per run because the model's reply varies.

## Differences

| Area | TypeScript | Python |
|---|---|---|
| Runtime | Node 22 | System `python3` was 3.9.6. Installed `python@3.13` with Homebrew and made the venv with `python3.13` |
| Packages | `npm install`, `package.json` | `python3.13 -m venv .venv`, activate it, `pip install anthropic`. `.venv/` goes in `.gitignore` |
| API key | `import "dotenv/config"` loads `.env` | Nothing loads `.env` for you. Either `export ANTHROPIC_API_KEY=...` or `python-dotenv` (`load_dotenv()`) |
| Client | `new Anthropic()`, everything `await`ed | `anthropic.Anthropic()`, synchronous, keyword arguments only. Passing the key positionally gave `__init__() takes 1 positional argument` |
| Tool schema | Zod, `z.toJSONSchema` generates the JSON Schema | A handwritten dictionary. I compared the two with `diff` and they were identical except for two parameter names |
| Validating tool input | Zod parses the model's input | No schema library. The function signature checks the argument names, and a missing one raises `TypeError`, which `execute_tool` turns into an error result. Types are not checked |
| Reserved word | Parameter `from` is fine | `from` is a Python keyword, so I renamed the parameters `from_currency` and `to_currency` |
| Cost of that rename | | The longer names added exactly 12 input tokens per request. Putting `from`/`to` back gave 957, the same as TS. About 60 tokens over a 5-step run |
| Number printing | `String(693375)` gives `693375` | `str(693375.0)` gives `693375.0`. I wrote a `fmt()` helper to print whole numbers without `.0` |
| JSON printing | `JSON.stringify` is compact | `json.dumps` adds spaces after `,` and `:`. I passed `separators=(",", ":")` to match |
| Time string | `Intl.DateTimeFormat` | `datetime.now(ZoneInfo(tz)).strftime(...)`. Python zero-pads the day (`08 November`) |
| Invalid time zone | `RangeError: Invalid time zone specified: Asia/Atlantis` | My tool returned `Invalid timezone: Asia/Atlantis` with `is_error` set. Python's own exception is a different type with different text |
| Result type | `interface` | `@dataclass AgentResult` |
| Message history | Plain objects, typed by the SDK | Plain dicts. I append `res.content` (SDK objects) directly and it works |
| Typos | The compiler flags a wrong import before I run anything | `from dataClasses import dataclass` only failed at run time with `ModuleNotFoundError`, because names are case-sensitive |
| Errors | Short stack traces | Long tracebacks. The useful line is the last one |

## What Python does not check for me

- Types of tool arguments (a number passed where a string belongs fails later, inside the function).
- Spelling of module and attribute names until the line runs.
- The shape of the dictionary I send as a tool definition. A typo in `input_schema` is the API's problem, not Python's.

## The model's behaviour about "Atlantis"

"What time is it in Atlantis?" never reached the tool. The model said Atlantis is a mythical island and offered to look up a real place. To test the invalid time zone path I called `execute_tool` directly.

## Lessons

- Port by reading the SDK types, not by guessing. The loop was a line-for-line translation: the same stop reasons, the same content blocks, the same single user message with all the results.
- Tool and parameter names are part of the prompt, and I pay for them on every request.
- A direct call to the tool function is the way to test an error path the model will not trigger.
