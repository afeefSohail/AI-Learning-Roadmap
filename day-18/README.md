# Day 18: Write tools, safely

**Week 4: MCP with a real backend**

## What I read before coding

1. The SDK Tools page: annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and their defaults.
2. The SDK Elicitation page, and what a server does when the client cannot ask.
3. The [Tools page of the 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): "User Interaction Model", "Security Considerations", "Input Required Tool Results" and the warning that clients must treat annotations as untrusted.
4. My own backend: the controllers for `PATCH /user/me` and `DELETE /user/photos/:photoId`.
5. My Day 17 "What I would change" and my Day 16 "Not verified". (Checked against the Day 18 results: annotations, elicitation and the confirmation design are closed. The rest stays open, see "Not verified" below.)

## Questions I answered before coding

See `NOTES.md` (Q1 to Q7). Short version:

| Question | My answer |
|---|---|
| Annotations for the write tools? | Both: `readOnlyHint` false, `destructiveHint` true, `idempotentHint` true, `openWorldHint` false. Annotations are hints and guarantee nothing. |
| How to confirm a delete? | Elicitation, failing closed. A confirmation code (two tools) gives no human gate, because the model can call the second tool itself. A hint alone fails open. |
| What does JSON mode do to elicitation? | I predicted a hang. The experiment showed an immediate fail-closed error on a 2025-era connection, and a working confirmation on 2026-07-28. |
| Where does the ownership check live? | In the API. A missing photo and someone else's photo both give 404 and the same text. |
| What does the model hear after a timeout on a write? | The outcome is unknown, do not call the tool again, check with a read tool. |

## What I built

All in `day-18/`:

- `write-client.ts`: one attempt for `PATCH` and `DELETE`, never retried. A timeout, a dropped connection or a 5xx becomes `OutcomeUnknownError`.
- `create-server.ts`: the three Day 17 read tools plus `update_profile` and `delete_photo`.
  - `update_profile` accepts only `name` (1 to 100 characters after trimming) and sends only `name`.
  - `delete_photo` checks that the client declared elicitation, looks the photo up, asks the user, and calls DELETE only on an explicit accept. The answer travels under a key that contains the photo ID.
- `http-server.ts`: the Day 17 HTTP wrapper with the new tools.
- `mock-api.ts` and `server.test.ts`: 14 tests against a mock API.
- `probe.ts`: the experiment that compared `input_required` and old-style elicitation, with and without my buffering.

```bash
export USERAUTH_BASE_URL=http://localhost:3000
npx tsx day-18/http-server.ts
node --import tsx --test day-18/*.test.ts
npx tsx day-18/probe.ts
```

## Key idea: a delete has two ways to go wrong, so it fails closed on both

The tool deletes only when the user said yes to this photo. If the client cannot ask, if the user declines, or if anything is unclear, nothing is deleted. After the DELETE has been sent, a failure means "unknown", not "failed", so the tool never invites a retry.

## Results

### Automated tests: 14 of 14 pass

| Group | Tests |
|---|---|
| Confirmation | decline; cancel and `confirm: false`; client without elicitation fails closed before any API call; 2025-era client fails closed; accept deletes once with the user's token and the question names the photo; missing photo and someone else's photo give the same text and no question; an answer for one photo does not open another |
| Failed writes | DELETE timeout (one attempt, and the photo really was deleted); 5xx on DELETE; 5xx on `update_profile`; expired token becomes an HTTP 401 |
| `update_profile` | changes the name and sends only `name`; empty, blank and over-long names rejected before any API call |
| `tools/list` | annotations match my table; no tool takes a `userId`, `token` or `email` |

### Mutation checks

| Mutation | Tests that failed |
|---|---|
| Remove the early return after "No" | 1 and 1b |
| Remove the capability check | 2 and 2b |
| Accept any answer for any photo | 8 |
| Retry the DELETE once | 5 and 5b |
| Tell the model "Please try again" | 5 |

### The experiment (`probe.ts`, in-process, SDK 2.4.0, JSON mode)

| Case | Result |
|---|---|
| Modern client, accepts | Deleted, 1 call |
| Modern client, declines | Cancelled, 0 calls |
| Modern client, cannot ask | Protocol error, 0 calls (the real tool now turns this into a tool error) |
| Modern client, accepts, with my POST buffering | Deleted, 1 call |
| 2025-era client, `input_required` or old-style `elicitInput`, with and without buffering | Error at once, 0 calls |

Reproduced on my Mac with the same results.
**The README:** says "about 400 to 530 tokens". Your output says 396 to 527. The README rounds it, which is fine, but if you want the exact numbers, use 396 to 527.
**It is still an estimate.** The script divides characters by 4 and by 3, so the table is a range from my formula. The API did not count it. To close the row properly, compare usage.input_tokens from your Day 14 agent for one request with these tools and one without. I haven't done that.
### Real API with the MCP Inspector 2.16

| Check | Result |
|---|---|
| `delete_photo`, 2025-era connection | "This client cannot ask the user for confirmation, so the photo was not deleted." |
| `update_profile` with a fresh token | Name changed, and `get_me` showed the new name |
| `delete_photo` on 2026-07-28, user declines | "Deletion cancelled. The photo was not deleted." |
| `delete_photo` on 2026-07-28, user accepts a throwaway photo | "Photo 3 was deleted." |
| `update_profile` to restore my old name | Done |

### Size of the five tool definitions

`day-18/measure.ts` lists the tools through the handler and measures name, description and input schema as they would be sent to the model.

| Tool | Characters | Tokens (estimate) |
|---|---|---|
| `get_me` | 190 | 48 to 63 |
| `list_photos` | 236 | 59 to 79 |
| `get_photo` | 340 | 85 to 113 |
| `update_profile` | 380 | 95 to 127 |
| `delete_photo` | 436 | 109 to 145 |
| **Total** | **1582** | **about 400 to 530** |

The token figures are estimates (characters divided by 4 and by 3), not a count from the API. For an exact number, compare `usage.input_tokens` of a request with these tools against one without.

## Findings

### 1. The SDK has the 2026 confirmation pattern
A tool handler returns `inputRequired(...)` and reads the answer on the retry from `ctx.mcpReq.inputResponses`. It needs no stream, so it works in `responseMode: "json"`.

### 2. A 2025-era connection cannot be asked at all
The stateless server cannot send a request to the client. The SDK says so at once. My prediction that the call would hang was wrong, and buffering made no difference.

### 3. "No" and "no answer" look the same
`acceptedContent(...)` returns `undefined` for decline, cancel and a missing answer. The handler must read the answer's `action`, or a "No" turns into a second question.

### 4. An answer must be tied to one photo
Under a shared key, an old answer would open any photo. A key such as `confirm_delete_photo_<id>` fixes it, and test 8 catches the mutation.

### 5. A tool can read what the client can do
`ctx.mcpReq.envelope[CLIENT_CAPABILITIES_META_KEY]` holds the declared capabilities on the 2026 era. It is empty on the 2025 era. That lets the tool return a friendly tool error instead of a thrown protocol error.

### 6. After a write is sent, a failure means "unknown"
The timeout test shows why: the photo was deleted on the server although the client saw a timeout.

### 7. My backend's update route has gaps
From the code I pasted: no validation of `name`, a probably unreachable "user not found" branch, and a response that sends `user` instead of `userWithFullPhotoUrls`. I have not changed the backend.

### 8. The Inspector can speak either protocol
The earlier "it will never confirm" claim was wrong. On 2025-11-25 it cannot be asked, and on 2026-07-28 it shows the confirmation.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| `EADDRINUSE` on port 3333 | The Day 17 server was still running | Stop it with Ctrl+C |
| "Dynamic Client Registration rejected (HTTP 404)" on `update_profile` | The server answered 401 and the Inspector then tried OAuth. Most likely a stale token (they last 15 minutes) | Log in again, update the header, reconnect |
| (Claude) predicted that a 2025-era confirmation would hang | I assumed a stream existed | Ran the experiment: it fails closed at once |
| (Claude) said my backend had a 5-character name minimum | It came from a note I had not checked against the code | Corrected in `NOTES.md` |

## Not verified

- How I switched the Inspector to 2026-07-28, and the exact wording of its confirmation (confirm).
- `list_photos` after the accepted delete. I saw "Photo 3 was deleted." but did not paste the list.
- The manual ownership test against the real API (User A and User B, from `NOTES.md` Q4).
- Claude Code: whether it uses `destructiveHint` and how it handles the confirmation.
- My Day 14 agent in `auto` mode with an elicitation handler.
- A token that expires between the question and the DELETE. In my design the client's retry carries the answer, so the user should not be asked twice, but I did not test this.
- A stateful 2025-era server, which might let old clients confirm.

## What I would change

- Add a validator for `name` to the API, so the limit does not exist only in the tool.
- Fix the controller gaps listed in Finding 7.
- Write a small script client with an elicitation handler, so the confirmation can be tested without the Inspector.

## Rules of thumb

- A delete needs a yes for this exact resource. No answer means no delete.
- A client that cannot ask gets an error, never a delete.
- After a write is sent, never say "try again". Say "unknown" and name a read tool to check.
- The ownership check lives in the API, and the tool says the same thing for "missing" and "not yours".
- Annotations are hints. Safety comes from the server.

## Next (Day 19)

Remote server over HTTP: put the MCP server in Docker Compose next to the API and Postgres and connect from Claude. One thing to plan first: `http-server.ts` listens on `127.0.0.1` and uses `localhostHostValidation()`, so a container will not accept requests from another container or from the host until the bind address and the allowed hosts are changed.
