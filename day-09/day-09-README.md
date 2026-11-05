# Day 09: Auth and saved conversations

**Week 2: Tool calling and APIs**

## What I read before coding

1. [Express: using middleware](https://expressjs.com/en/guide/using-middleware.html): middleware runs in order. `app.post("/chat", requireAuth, handler)` runs the check before the handler on that route only, and a middleware passes data on through the request or `res.locals`.
2. [JWT introduction](https://jwt.io/introduction): a token is `header.payload.signature`. The server verifies the signature with the secret and needs no database call, and `exp` makes the token expire.
3. **Prisma quickstart for PostgreSQL with TypeScript** ([prisma.io/docs](https://www.prisma.io/docs)). I used Prisma 7 (`^7.9.1`), where:
   - a driver adapter is required (`@prisma/adapter-pg`, passed as `new PrismaClient({ adapter })`)
   - `prisma.config.ts` at the project root holds the schema path, the migrations path and the database URL
   - the generator is `prisma-client` with a required `output` path, and `PrismaClient` is imported from that generated folder
   - `.env` is not loaded automatically (I use `dotenv`)
   - Node 20.19 or newer and TypeScript 5.4 or newer ([upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-to-prisma-7))
4. [Prisma relations](https://prisma.io/docs/concepts/components/prisma-schema/relations): one-to-many, with the foreign key and `@relation` written in the schema, and `include` and `orderBy` for reading messages back.

**Prisma 7 or 8?** Prisma 8 exists but is a release candidate (8.0.0-rc.30 on 3 November 2026 per the [release status page](https://www.prisma.io/docs/orm/release-status)). It has a different API: new packages (`@prisma/orm-postgres`), a "contract" file instead of the schema, chained queries, and it needs Node 22.18 or newer, while I have 22.17. See the [7 to 8 migration guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql). I stayed on 7, which is stable. Migrating later means changing the database code in one place.

**Questions I answered before coding:** see "Design decisions" below.

## What I built

- `prisma.config.ts` (repo root): points Prisma at `day-09/prisma/`.
- `day-09/prisma/schema.prisma`: `User`, `Conversation` and `Message`.
- `day-09/db.ts`: the Prisma client with the Postgres adapter.
- `day-09/auth.ts`: `requireAuth`, a middleware that verifies the UserAuth access token locally.
- `day-09/server.ts`: the Day 8 chat server with auth and storage.
- `day-09/public/index.html`: a small chat page with a token field.

| Endpoint | What it does |
|---|---|
| `POST /chat` | Takes `{ conversationId?, message }`, saves both sides of the exchange and streams the reply |
| `GET /conversations` | The caller's conversations, newest first |
| `GET /conversations/:id` | One conversation with all its messages, or 404 |

```bash
npx prisma migrate dev --name init     # run from the repo root
npx prisma generate
npx tsx day-09/server.ts               # port 3001, because UserAuth uses 3000
```

## Key idea: the server owns the history and the identity

- Until Day 8 the client sent the whole conversation. Now it sends only the new message and the id of the conversation, and the server loads the history from Postgres.
- The server never trusts the client for who they are. It takes the user id from a **verified access token** (the one UserAuth issues) and puts that id in every query: `where: { id, userId }`.

## How `POST /chat` works

1. `requireAuth` checks the `Authorization: Bearer` token with the same secret UserAuth signs with, with the algorithm pinned, and puts the user id in `res.locals`.
2. Zod validates `{ conversationId?, message }` with `.strict()` (a UUID, one message of 1 to 4000 characters, nothing else).
3. With an id: find the conversation for this user, or 404. Without one: create it, with a title from the first 60 characters and the user created on first use (`connectOrCreate`).
4. Save the user's message, then load the last 20 messages (the window must start with a user message) and send them to the model.
5. Stream the reply. The first event is `conversation` with the id, so the client has it before the reply finishes.
6. On success, save the assistant message with its stop reason and token counts. On a client disconnect, save the partial text plus `[stopped by user]`. On a failure before any text, delete the saved user message (and a conversation created in this request) and return 502 or 504.

## Design decisions

| Question | Decision |
|---|---|
| Verify the JWT in `/chat` or call UserAuth? | Verify locally with the access secret. No network call, and `/chat` works if UserAuth is down. The cost: a disabled user keeps working until the token expires (15 minutes), and the secret now lives in two services. |
| `User` table? | A minimal one (`id`, `createdAt`), created on first use. It is optional (ownership comes from the query, not from the table), but it gives a foreign key and a place for per-user data later. UserAuth stays the source of truth. |
| Someone else's conversation: 403 or 404? | 404. It does not reveal that the conversation exists. |
| What does the client send? | `conversationId` and the new message. With no id (or `null`), the server starts a new conversation and returns the id in the first event. |
| When to save the user's message? | Before the model call, and remove it again if the model fails before any text, so a retry does not duplicate it. |
| Disconnect mid-stream | Keep the text collected so far and save it with `[stopped by user]` (the Day 3 lesson). |
| How much history? | The last 20 messages. A percentage of the chat does not work because it varies, and the window has to start with a user message. |

## Results

### Auth

| Request | Result |
|---|---|
| No `Authorization` header | 401 `Missing bearer token.` |
| `Bearer abc` | 401 `Invalid or expired token.` |
| The 7-day refresh token | 401 `Invalid or expired token.` |
| An expired access token | 401, same message |

### Conversation flow

- New chat: first event `conversation` with the id, then text, then `done` (36 in / 26 out, $0.0000166).
- Follow-up with only `{conversationId, message}`: "Your name is Afeef." (69 in / 11 out, $0.0000124). Input grew from 36 to 69 because the server loaded the earlier messages.
- `GET /conversations/:id` returned four messages in order. Assistant rows carry `stopReason: end_turn` and token counts. User rows have nulls.

### Disconnect

Ctrl+C partway through a story: the server logged `client disconnected, aborting the model stream` and `saving partial reply (857 characters)`. The last message is `role: assistant`, `stopReason: aborted`, the text ends mid-quote with `[stopped by user]`, and `inputTokens`/`outputTokens` are `null`. The final usage never arrives on an abort, but the tokens are still billed.

### Bad Anthropic key

Both requests (an existing conversation and a new one) returned `502 upstream_error` with a generic body. The server log has the full 401 and the request id. Afterwards the existing conversation still had 4 messages and no conversation titled "this new chat should fail too" existed, which shows the rollback works.

### History window

| Question | Window of 20 | Window of 2 |
|---|---|---|
| 1 (name) | 36 in | 34 in |
| 2 (France) | 70 in | 37 in |
| 3 (2 + 2) | 94 in | 39 in |
| 4 ("What is my name?") | 114 in, knew the name | 34 in, "I don't know your name" |

### Ownership (second account, user id different from 1)

| Request | Result |
|---|---|
| Read the first user's conversation | 404 `{"error":"not_found"}` |
| Chat in the first user's conversation | 404, same response |
| A valid UUID nobody owns | 404, same response |
| Second user's own list | `{"conversations":[]}` |
| First conversation afterwards | still 6 messages |

The three 404 responses were byte-for-byte identical (same body, same length, same ETag).

### Cost

A 500-word story request: 47 in / 1000 out, $0.0005047, stop reason `end_turn`. Output tokens include hidden thinking, so `MAX_TOKENS = 1000` is tight for long answers.

## Findings

### 1. Memory moved from the client to the server

The second turn sent only the new message and the model still knew my name. The history is the Day 2 pattern again, but the server rebuilds it from the database.

### 2. Access and refresh tokens look the same

Both carry only `userId`, `iat` and `exp`, with no token-type claim. The refresh token (7 days) is rejected by `/chat` only because UserAuth signs the two with different secrets. If they shared a secret, `/chat` would accept a refresh token, and the lifetime would be the only difference.

### 3. HS256 means the verifier can also forge

With a shared secret, anyone who holds the access secret can create valid access tokens for any user. Putting that secret in the chat server means a break-in there also breaks the login system. A key pair (RS256) avoids that but needs a change in UserAuth.

### 4. Ownership is enforced by the query

Every read and write filters by `userId`, so a wrong id and someone else's id are the same "not found". Nothing leaks.

### 5. The rollback keeps retries clean

A failure before any text removes the saved user message, so a client that retries does not leave two copies of the same question in the history.

### 6. A small window is cheap and forgetful

Input stayed at 34 to 39 tokens, about 70% less than the unlimited run's 114 on the last question, but the model forgot the name twice. The database still has everything. Only what is sent to the model is limited. Summaries or pinned facts come in Week 7.

### 7. An ownership test needs a different identity

My first "second account" was just a second login of the same user (`userId: 1`), so every request correctly succeeded. Decode the token and check the user id before trusting a test.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| TypeScript: `string | undefined` is not assignable to a secret | The check at the top of `auth.ts` did not carry into the hoisted function | Copy to a typed constant: `const SECRET: string = secretFromEnv` |
| 401 with a valid token | The secret was set under `JWT_SECRET` while the real access secret was under another name | Use the access secret. The generic message hid the reason, so log the real one |
| The last stream event had no name | `sendEvent(res, "    ", ...)` instead of `"done"` | Restore `"done"` |
| `migrate dev` loaded `prisma/schema.prisma` and asked for `datasource.url` | No working `prisma.config.ts` at the repo root | Root config with `schema: "day-09/prisma/schema.prisma"` and the database URL |
| `Cannot find module './generated/prisma/client.js'` | The client had not been generated yet | `npx prisma generate` from the repo root |
| `Invalid UUID` and a JSON parse error | I pasted placeholder text (`PASTE_ID`, `PASTED_TOKEN`) | Use the real value or a variable |
| `TypeError: Cannot read properties of undefined (reading 'messages')` in my one-liners | The token had expired (15 minutes), so the response had no `conversation` | Log in again for a fresh token |
| The history-window test had no effect | `HISTORY_LIMIT` was a constant, not read from the environment | `Number(process.env.HISTORY_LIMIT ?? 20)` |

## Not tested

- The browser page after the final fix (I tested with curl).
- The `event: error` path when the model fails after the stream has started.
- Two requests at once in the same conversation.
- Pagination of `GET /conversations` (it returns the 50 most recent).

## What I would change

- Log only the status and request id of an upstream error instead of the whole error object with headers.
- Raise `MAX_TOKENS` or make it configurable.
- Add rate limiting and a way to rename or delete a conversation.
- Create the conversation and the first message in one transaction.
- Move to RS256 and a token-type claim if UserAuth can change.
- Revisit Prisma 8 once it is out of release candidate.

## Rules of thumb

- Take identity from a verified token, never from the request body.
- Filter every query by the owner, and answer "not yours" with the same 404 as "does not exist".
- Verify tokens with the algorithm pinned.
- Save the user's message first, and undo it if the model fails before any text.
- Save the partial reply on a disconnect, with a note.
- Send the model a window of the history, not all of it.
- Never paste tokens or secrets into chat or commit them. Use environment variables.

## Next (Day 10)

Python reading day: the same tool-calling flow in the Python SDK, the Day 7 agent loop rewritten in Python, and the differences between TypeScript and Python noted down, plus the week-2 review.
