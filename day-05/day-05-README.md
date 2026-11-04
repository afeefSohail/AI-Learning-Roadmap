# Day 05: Prompt engineering basics

**Week 1: LLM foundations in TypeScript**

## What I read before coding

1. [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) (45 minutes, the "General principles" section):
   - Be clear and direct. Test: show the prompt to a colleague with no context. If they would be confused, the model will be too.
   - Examples: 3 to 5 relevant, varied examples in `<example>` tags steer format and tone better than long descriptions.
   - XML tags: consistent, descriptive tags separate instructions, context and inputs.
   - A one-sentence role in the system prompt helps.
2. [Use examples (multishot prompting)](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting) and [Use XML tags to structure your prompts](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags) (15 minutes each).

The docs have no page on prompt templates (a template is a TypeScript function that returns a string) or on testing prompts. I compared styles with real runs.

**Brainstorm before coding:** pick one task with a clear right answer (support-message classification), define what "better" means, write 8 or more test inputs including tricky ones, and choose the styles to compare.

## What I built

Four prompt styles run against the same task, scored with real numbers.

- `templates.ts`: each prompt style is a plain TypeScript function that takes the message and returns the prompt. That is all a prompt template is.
- `cases.ts`: 10 test messages with the label I decided is correct before running anything.
- `compare.ts`: runs 4 styles × 10 cases × 3 repeats = 120 calls and prints a comparison table.
- `results.json`: the raw replies, token counts and stop reasons for all 120 calls.

```bash
npx tsx day-05/compare.ts
```

**Task:** classify a customer support message as `billing`, `bug`, `feature_request` or `general_question`.

## The four styles

| Style | What the prompt contains |
|---|---|
| `plain` | One line: "Classify this customer support message: ..." No labels. |
| `plainWithLabels` | One line that lists the 4 labels and says "Reply with only the category." |
| `structured` | System role, then XML tags: task, categories with descriptions, rules, message |
| `fewShot` | `structured` plus 4 examples (none of them appear in the test cases) |

The rules in `structured` and `fewShot`: reply with only the category name; if a message mixes issues, choose the first one mentioned; if it is too vague, reply `general_question`.

## Test cases (10)

4 clear ones (billing, bug, feature request, how-to), a mixed message ("refund me, and the export button does nothing"), Roman Urdu, sarcasm, a vague message ("It doesn't work."), and two boundary cases ("The refund button is greyed out." and "Will you ever support Apple Watch?"). I fixed the expected labels before running and did not change them afterwards.

## Results (computed from results.json)

| Style | Exact format | Accuracy | Consistent cases | Cut off | Avg in | Avg out | $ per 1000 calls |
|---|---|---|---|---|---|---|---|
| plain | 0% | 40% | 8/10 | 18 | 32 | 178 | 0.0921 |
| plainWithLabels | 100% | 80% | 10/10 | 0 | 62 | 4 | 0.0085 |
| structured | 100% | 90% | 10/10 | 0 | 252 | 21 | 0.0356 |
| fewShot | 100% | 90% | 10/10 | 0 | 417 | 11 | 0.0472 |

- **Exact format:** the reply was only the label, nothing else.
- **Accuracy:** exactly one label found in the reply and it matched the expected one (see finding 3 for why this undercounts `plain`).
- **Cut off:** replies stopped by `max_tokens` (200).
- Prices: Haiku 5.5 at $0.10 / M input and $0.50 / M output.

## Findings

### 1. A prompt is a spec

`plain` never said which labels exist or what the reply should look like. So the model invented categories ("Account Management / Profile Settings"), added priority, sentiment and routing advice nobody asked for, and 18 of 30 replies were cut off at 200 tokens. Exact format was 0%: no reply was usable by code. One extra sentence (`plainWithLabels`: list the labels, "reply with only the category") fixed the format completely.

### 2. Output tokens decide the cost

`plain` used 178 output tokens per call on average and `plainWithLabels` used 4. Even though `plain` has the shortest input (32 tokens vs 62), it costs about 11× more per call ($0.0921 vs $0.0085 per 1000). Output costs 5× more per token. The real cost of `plain` is higher, because the 200-token cap hid how long its replies would have been.

### 3. My scoring made `plain` look worse than it was

The parser looks for exactly one label word in the reply. For "Could you add dark mode?" the model correctly said "Feature Request", but the text also said "not a bug", so the parser read `bug`. For the refund-button case, the reply mentioned both "technical issue" and "billing", so the parser returned nothing. `plain`'s 40% accuracy is partly a parser problem. The exact-format column is the honest number: with plain output, my code could not reliably extract an answer at all.

### 4. Rules matter where you need one specific decision

`plainWithLabels` (80%) and `structured` (90%) differ on one case: "It doesn't work." `plainWithLabels` said `bug` 3 times out of 3. `structured` said `general_question` 3 out of 3, because it has the rule "if too vague, reply general_question". `structured` also changes several other things at once (system role, XML tags, category descriptions), so this test can't say which part helped. The rule is the most likely cause, since it is the only part that addresses this case.

### 5. Few-shot examples did not help here

`fewShot` and `structured` both scored 90%, and `fewShot` cost about 33% more per call because the 4 examples add roughly 165 input tokens to every request. On a task this easy, the rules were enough. The examples did not cover the Apple Watch case, which is the one place they might have mattered.

### 6. The model disagreed with my label

For "Will you ever support Apple Watch?" I expected `general_question`. All 9 runs in the three label-based styles answered `feature_request`. I kept my expected label, because changing it after seeing the answer would just fit the test to the model. It is a real ambiguity in my category definitions: asking whether a feature will exist is arguably a feature request. To teach my intended judgment, add a rule or an example and test with a different phrasing, so the test stays held out.

### 7. Output tokens include hidden thinking

For "The refund button is greyed out.", `structured` replied with the single word `bug` three times but used 154, 181 and 164 output tokens. `fewShot` did the same once (197 tokens). A one-word reply is about 4 tokens, so the rest was almost certainly thinking the model did before answering, which is billed as output. `plainWithLabels` answered the same case in 4 tokens every time. Boundary cases make the model think more, and this only shows up in the usage numbers, not in the text. This also explains the large output counts for short replies on earlier days.

### 8. What did not need help

Roman Urdu and sarcasm were classified correctly by all four styles, including `plain`. Consistency across repeats was 10/10 for every style except `plain` (8/10).

### 9. Latency

Ignore the latency numbers. The 3 repeats run at the same time and several show identical millisecond values, so they say nothing reliable.

## Limits of this test

- 10 cases, 3 repeats each, one model (Haiku 5.5), one run of the whole experiment.
- The expected labels are my own decisions.
- Three ingredients (XML tags, descriptions, rules) change together between `plainWithLabels` and `structured`, so I can't separate their effects yet.

## Errors I hit

| Error | Cause | Fix |
|---|---|---|
| `'case' is not allowed as a variable declaration name` (plus about 20 follow-on errors, including "Variable 'cases' implicitly has an 'any' type") | `case` is a reserved word in JavaScript and TypeScript | Rename the loop variable to `testCase` |

All the other errors in the list were side effects of that one line failing to parse.

## What I would try next

1. Add a style with the rules but plain formatting (no XML tags) to see whether the tags or the rules did the work.
2. Add an example or rule for roadmap questions ("Do you plan to...?") and test with a new phrasing, such as "Is a Windows version coming?"
3. Turn `max_tokens` up for `plain` to see its true cost.

## Rules of thumb

- State the output format and the allowed labels explicitly.
- Rules decide ambiguous cases. Examples show judgment but cost tokens on every call.
- Check the usage numbers, not just the text.
- Decide what "correct" means before running the test.
