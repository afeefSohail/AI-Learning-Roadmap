# Day 18 notes: annotations, confirmation and ownership

> Answers written before coding. Paragraphs marked "Review note (from Claude, not yet in my own words)" are corrections or results I still have to restate myself. The experiment result in Q3 comes from `day-18/probe.ts`.

## Q1. Annotations: which values for `update_profile` and `delete_photo`, and what does an annotation guarantee?

**My answer:** `update_profile` is a reversible overwrite, and `delete_photo` is a permanent, idempotent delete. An annotation guarantees nothing to the client.

| Hint | `update_profile` | `delete_photo` |
|---|---|---|
| `readOnlyHint` | false: it changes data | false: it removes data |
| `destructiveHint` | true: it overwrites the old name, and false would mean additive-only | true: it permanently removes the photo and its file |
| `idempotentHint` | true: the same name again changes nothing more | true: after the first delete a second call changes nothing more |
| `openWorldHint` | false: it talks only to my own API and database | false: same reason |

The defaults are `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false` and `openWorldHint: true`. `destructiveHint` and `idempotentHint` only mean something when `readOnlyHint` is false. Checked against the 2026-07-28 schema, annotations.

A second `delete_photo` on the same ID returns 404. It is still idempotent. Idempotence is about the effect on the environment, not the response. The end state is identical after the second call, which is also why HTTP DELETE counts as idempotent.

What an annotation guarantees: nothing. Annotations are hints, and clients must treat them as untrusted unless the server is trusted. Clients use them for user experience, such as confirmation prompts for destructive tools or auto-approving read-only ones. They do not change what the tool does, and real safety comes from the server.

## Q2. Confirmation: which option, and what does each client do?

**My answer:** (a) elicitation, with a fail-closed fallback, and `destructiveHint: true` kept.

- Option (b), two tools with a confirmation code, gives no human gate, because the model that receives the code can call the confirm tool itself.
- Option (c), no confirmation in the server, leaves the decision to a hint the client may ignore, which fails open.

The tool first checks that the client declared the elicitation capability, and fails closed before any API call if it did not. It then looks up the photo, so a 401 or 404 surfaces before anything is asked. It then asks the user, and calls DELETE only on an explicit accept. Decline, cancel or any error means no delete.

**Trade-off:** the lookup makes `delete_photo` two API calls, GET then DELETE, so the "one API call per tool" rule no longer holds. It is worth it because the prompt can name the photo. If the token expires while the user is deciding, the DELETE gets a 401, the client refreshes and retries the whole `tools/call`, and the user is asked again. Nothing was deleted in that case. The `input_required` pattern avoids the second question, because the retry carries the earlier answer.

| Client | What it does with this |
|---|---|
| MCP Inspector | In my in-process test, a 2025-era client always fails closed (see Q3). The real Inspector is not checked yet. |
| Day 14 agent | Ignores annotations (the code only converts `inputSchema`). It connects in the default `legacy` mode, so `delete_photo` takes the fail-closed path every time, unless I change it to `versionNegotiation: { mode: "auto" }` and register an elicitation handler. |
| Claude Code | Unknown for annotations: I have not confirmed it uses `destructiveHint`. Its CLI supports elicitation dialogs, but other modes may auto-decline, which also fails closed. |

If the client does not support elicitation, the delete fails closed. Nothing happens, and the photo was not deleted.

**Review note (from Claude, not yet in my own words):**
- Decision: a client that cannot ask gets a tool error (`isError: true`, "This client cannot ask the user for confirmation, so the photo was not deleted."), not the thrown protocol error from the SDK. A tool can read the client's declared capabilities from `ctx.mcpReq.envelope[CLIENT_CAPABILITIES_META_KEY]`. A 2025-era connection has no envelope, so it fails closed the same way.
- The confirmation protects against a model that acts by mistake. It cannot protect against a client that lies about the user's answer.

## Q3. Conflict with Day 17: JSON mode, buffering and elicitation

**My answer (written before the experiment):** Elicitation needs the server to send a request while the tool is still running, and my JSON mode and buffering have nowhere to put it.

- JSON mode returns one `application/json` response instead of opening an SSE stream, so there is no stream to push mid-call messages through. They are dropped.
- POST buffering is a different mechanism: it holds the whole stream back until the tool ends, so an elicitation request would reach the client only after the tool finished, while the tool waits for the answer.
- Prediction: the tool call hangs until the client's timeout (60 s by default), then fails.
- Stateless HTTP on the Elicitation page: unknown. The 2025-11-25 page does not mention it. The 2026-07-28 page moves elicitation into an `InputRequiredResult` returned as the call's response, which needs no open stream.

**Review note (from Claude, not yet in my own words): the experiment** (`day-18/probe.ts`, in-process `createMcpHandler` with `responseMode: "json"`, SDK 2.4.0, a stub tool that counts API calls):

| Case | Result |
|---|---|
| Modern client (`versionNegotiation: auto`), user accepts | Deleted, 1 call |
| Modern client, user declines | "Deletion cancelled.", 0 calls |
| Modern client that cannot elicit | Protocol error thrown, 0 calls |
| Modern client, accepts, with my POST buffering | Deleted, 1 call |
| 2025-era (`legacy`) client, `input_required` tool | Tool error immediately, 0 calls |
| 2025-era client, old-style `ctx.mcpReq.elicitInput`, JSON mode or buffering | Tool error immediately, 0 calls |

- My prediction of a hang was wrong. On a 2025-era connection the stateless server cannot send anything to the client, and the SDK reports that at once ("per-request legacy serving cannot receive server-to-client requests"). Buffering makes no difference.
- `input_required` works in JSON mode for a client on the 2026 protocol, so choice (a) is workable. In the SDK: `inputRequired({ inputRequests: { ... } })`, read on the retry with `ctx.mcpReq.inputResponses`.
- `acceptedContent(...)` returns `undefined` for decline, cancel and "no answer" alike. The handler must check the answer's `action` itself. Otherwise a "No" becomes a second question.
- The confirmation is not bound to the photo. A key such as `confirm_<photoId>`, or the ID inside `requestState`, would stop an old answer from being used for a different photo. This is my reasoning and it is untested.
- Not tested: the real Inspector, Claude Code, and a stateful legacy server.

## Q4. Ownership: where does the check live?

**My answer:** The check lives in the API, which takes the user from the verified token. The tool passes the token through and never takes a `userId`.

- Photo does not exist: the API returns 404, and the tool tells the model "Photo not found, or you do not have permission to delete it."
- Photo belongs to someone else: the API also returns 404 (never 403), and the tool gives the same text, so the model cannot learn that a private ID exists.

A test that proves the check is on the API side calls the API directly as User B, bypassing the MCP server, then confirms User A still has the photo. It is a manual check, because it writes to the real database.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

const API = process.env.API_URL ?? "http://localhost:3000";
const A = process.env.USER_A_TOKEN!;
const B = process.env.USER_B_TOKEN!;

// 1x1 PNG, so Multer's image filter accepts the upload
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("API rejects User B deleting User A's photo", async () => {
  // 1. User A uploads a photo (multipart, field name "photos")
  const form = new FormData();
  form.append("photos", new Blob([PNG], { type: "image/png" }), "t.png");
  const up = await fetch(`${API}/user/me/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${A}` },
    body: form,
  });
  assert.equal(up.status, 201);
  const photoId = (await up.json()).data[0].id; // { meta, data: [photo] }

  // 2. Attack: User B calls the API directly
  const del = await fetch(`${API}/user/photos/${photoId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${B}` },
  });
  assert.equal(del.status, 404); // this API hides existence with 404

  // 3. Side effect check: the photo still exists for User A
  const get = await fetch(`${API}/user/photos/${photoId}`, {
    headers: { Authorization: `Bearer ${A}` },
  });
  assert.equal(get.status, 200);

  // 4. Clean up as the owner
  await fetch(`${API}/user/photos/${photoId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${A}` },
  });
});
```

`201` and `data[0].id` come from `uploadPhotos` in `photo.controllers.ts`, which responds with status 201 and `data: photos`, an array. Confirm them on the first run. Pass the tokens through environment variables and do not paste them anywhere. They last 15 minutes, so log in again if the test starts failing with 401.

## Q5. Failure on a write: what does the tool say after a timeout?

**My answer:** A 401 means the delete did not run, because the API rejects the request before deleting anything. A timeout or a 5xx on `delete_photo` leaves the result unknown, so the tool must not tell the model to retry.

- 401: not a tool result. The server answers the HTTP request with a real 401, the client refreshes the token and retries once, and only a failed refresh reaches the model.
- Timeout or 5xx: the tool returns `isError: true` with: "The request failed and the photo may or may not have been deleted. Do not call delete_photo again. Check with list_photos, or tell the user. Do not use get_photo for this: its 404 means both deleted and never existed."
- May it say retry? No. The first call may have succeeded. A blind second delete then returns 404, and the model would wrongly tell the user the photo never existed.
- Code: the write path must not share the read helper that retries once. Writes are never retried.

**Review note (from Claude, not yet in my own words):** the Day 17 message "The service is unavailable. Do not retry; tell the user." is wrong for a write, because it suggests that nothing happened. The write path needs its own "outcome unknown" message.

## Q6. Tests

**My answer:** Eight behaviours, with two mutations to show the suite can fail.

| # | Behaviour | Assertion |
|---|---|---|
| 1 | User declines elicitation | API call count is 0, and the tool says the deletion was cancelled |
| 2 | Client has no elicitation capability | API call count is 0, and the tool fails closed with a clear message |
| 3 | User accepts for their own photo | DELETE is called once with the bearer token, and the tool confirms the deletion |
| 4 | Missing photo against another user's photo | Both return the same text, and a direct API call as User B is rejected (Q4) |
| 5 | DELETE times out after confirmation | `isError: true`, the outcome is unknown, and the text tells the model not to retry |
| 6 | `update_profile` input | Only `name` is accepted, and empty input is rejected |
| 7 | `tools/list` annotations | They equal the values declared in Q1 |
| 8 | An answer for one photo is not accepted for another | A retry for photo 3 that carries the answer for photo 2 does not delete (needs the binding from Q3) |

- **Mutation 1:** remove the early return after "No", so the handler falls through to DELETE. Test 1 fails because the call count is 1, not 0. This only works because the test asserts the call count and not just the returned text.
- **Mutation 2:** remove the capability check, so an unsupported client falls through to the delete. Test 2 fails for the same reason.

Tests 1 to 3 and 8 need a client on the 2026 protocol (`versionNegotiation: { mode: "auto" }` and an elicitation handler). The Inspector cannot run them.

## Q7. `update_profile`: which fields, and open items

**My answer:** `name` only. The email is the unique login key, so changing it needs its own verification flow. The tool accepts a name of 1 to 100 characters after trimming (`NAME_MIN` and `NAME_MAX` in `day-18/create-server.ts`). My backend's `updateUser` controller has no minimum or maximum, so these limits exist only in the tool, which a direct API call bypasses. The same rule belongs in the API, as a validator on the route.

**Review note (from Claude, not yet in my own words):** the 5-character minimum I wrote earlier came from the signup validator, which I have not read. The `updateUser` controller you pasted has no validation. As far as I can tell from that code, with no change to the API:
- A missing `name` leaves the user unchanged and still answers 200.
- A non-string `name` probably ends as a 500 from Prisma.
- The `if (!user)` 404 branch is probably unreachable, because `prisma.user.update` throws when the row is missing.
- The response sends `user`, not `userWithFullPhotoUrls`, so the photo URLs are relative. The tool does not return photos, so it is not affected.

**Open items:**
- Inspector: its real elicitation behaviour and spec version are not checked. In my in-process test a 2025-era client always fails closed.
- Claude Code: whether it uses `destructiveHint` is unconfirmed, and so is its elicitation behaviour outside the CLI.
- Modern client that cannot elicit: decide whether the model should see a tool error instead of a protocol error.
- A stateful legacy server mode, which might let 2025-era clients confirm, is not tested.
