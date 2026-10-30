# Day 04: Structured output with Zod

**Week 1: LLM foundations in TypeScript**

## What I built

- `schemas.ts`: a Zod `ReceiptSchema` (merchant, date, currency, items, tax, total, `isReceipt`) plus rules JSON Schema can't express.
- `extractor.ts`: `extract(schema, text, { useSchema })` calls the model, parses the reply, validates it with Zod, and retries with the error message if validation fails (max 2 retries).
- `run.ts`: runs 4 test inputs (clean receipt, messy receipt, not a receipt, receipt with a discount) in two modes and prints attempts and tokens.

```bash
npx tsx day-04/run.ts
```

## Key idea

- The **API schema** (`output_config.format`, built from Zod with `z.toJSONSchema`) makes the output fit the **shape**.
- **Zod** checks the **rules** the schema can't express: whole-number quantities, items + tax = total, and "if `isReceipt` is false there are no items".
- The **repair loop** connects them: on failure, send the model its own answer plus the exact validation errors and ask for a correction. A retry limit stops it from running forever.

## How `extract` works

1. Convert the Zod schema to JSON Schema (`z.toJSONSchema`) and remove `$schema`.
2. Schema mode: send it in `output_config.format`. Prompt-only mode: put the JSON Schema text in the system prompt.
3. If `stop_reason` is not `end_turn`, throw. The JSON may be incomplete.
4. Strip code fences, `JSON.parse`, then `schema.safeParse`.
5. On failure: push the assistant reply and a user message with the Zod errors, then retry. After 2 retries, throw.

## Results (final run)

| Input | Mode | Attempts | Tokens in / out |
|---|---|---|---|
| discount | schema | 2 | 1459 / 357 |
| discount | prompt-only | 2 | 1052 / 567 |
| clean | schema | 1 | 664 / 110 |
| clean | prompt-only | 1 | 412 / 110 |
| messy | schema | 1 | 679 / 348 |
| messy | prompt-only | 1 | 427 / 344 |
| not a receipt | schema | 1 | 629 / 43 |
| not a receipt | prompt-only | 1 | 377 / 43 |

Single runs, so output token counts vary from run to run.

## Findings

### 1. Schema mode vs prompt-only

- Both modes returned correct data on every input.
- Schema mode costs extra input tokens: a constant amount per schema, which grew from 228 to 252 tokens as the schema grew. At Haiku prices it is tiny, but it adds up at volume.
- The difference is the guarantee. Schema mode guarantees valid JSON in the right shape. Prompt-only relies on the model, with Zod and the retry loop as the safety net.

### 2. A valid shape is not a correct answer

- The "not a receipt" text first returned an empty receipt (`""`, `0`, `[]`) that passed validation, because the schema gave the model no way to say "this isn't a receipt".
- Fix: a nullable `tax`, and an `isReceipt` boolean.
- `isReceipt` then came back `false` for the clean receipt in schema mode (twice) while the data was fully extracted. Validation passed, because `false` is a valid boolean. After adding `.describe("true only if the text is a purchase receipt or bill")` and putting the field first, it was correct in every run.
- I added a Zod rule for contradictions: if `isReceipt` is false, `items` must be empty.

### 3. The repair loop

- The discount input (items total 11, printed total 9) failed the "items + tax = total" rule in both modes, and the repair succeeded on the second attempt.
- The model fixed it by adding an item named `discount` with price -2. The validator passes, but a discount isn't a product. **The loop satisfies the validator, not necessarily the truth.** A cleaner design would be a separate `discount` field in the schema.
- A repair is expensive: 1,052–1,459 input tokens vs 412–679 for a single attempt, because the retry resends the original prompt, the bad answer and the error.
- Failure message sent back to the model:
  `(root): items (quantity × price) plus tax must equal total`
  (`(root)` appears because the rule is on the whole object. Adding `path: ["total"]` names a field.)
- The repair was the same in both modes and in repeated runs: a `discount` item with price -2.

### 4. Other notes

- `tax: null` appeared for the not-a-receipt input, so the nullable field works.
- The date `26/10/26` became `2026-10-26`. The model guessed the date format.
- Merchant capitalization follows the source text. A schema doesn't control it, and a Zod `.transform` could.

## Errors I hit

| Error | Cause | Fix |
|---|---|---|
| `400: For 'integer' type, properties maximum, minimum are not supported` | Zod 4's `.int()` becomes `minimum`/`maximum` in JSON Schema, and the API doesn't support them | `z.number().refine(Number.isInteger, ...)`. Keep the API schema simple and put stricter rules in Zod refinements |
| Every run failed with "Stopped with end_turn" | The stop-reason check was inverted (`===` instead of `!==`) | Throw only when `stop_reason !== "end_turn"` |
| Both modes gave identical token counts | `useSchema: true` was hard-coded in the call, so prompt-only never ran | Pass the loop variable `{ useSchema }`. A debug print found it |

The last one means my first comparison wasn't real. Always check that a flag actually reaches the code it's meant to change.

## Reading

- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Zod](https://zod.dev/api)
- [Type-safe LLM outputs with Zod](https://dev.to/thegdsks/type-safe-llm-outputs-with-zod-stop-guessing-what-the-model-returns-544e)
- [Instructor: reask validation](https://git.kennethreitz.org/kennethreitz/instructor/src/commit/20c50f0fe69d591fa8e64dfe05902d112b059782/docs/concepts/reask_validation.md)
