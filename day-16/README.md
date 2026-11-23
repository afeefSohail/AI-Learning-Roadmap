# Day 16: Design the UserAuth MCP server

**Week 4: an MCP server for my UserAuth API**

No code today. The deliverable is this design. The full tool spec is in `UserAuth MCP Server Tool Spec.pdf` (kept next to this README), and the tables below summarise it.

## What I read before coding

1. The v2 SDK [Authorization (server side)](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.md) page: requiring a bearer token, token verification, protected-resource metadata and scopes.
2. The v2 SDK [stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.md) page, to compare where a stdio server gets its credentials.
3. The MCP authorization [security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations.md): audience validation and the ban on token passthrough.
4. The v2 SDK [Elicitation](https://ts.sdk.modelcontextprotocol.io/v2/servers/elicitation.md) page, read in full: asking the end user a question during a tool call, which is the candidate for confirming `delete_photo` on Day 18.
5. My own UserAuth source: the routes, controllers, `requireJWTAuth`, `jwt.util.ts` and the Prisma schema.
6. My Day 11 `NOTES.md` (transports and HTTP authentication) and my Day 14 and 15 READMEs.

7. The v2 SDK [Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.md) page, read in full, including the tool annotations (see "Not verified" for what I still have to write down from it).

**Questions I answered before writing the design:** transport, token source and expiry, verify or forward, the five tools, why no `userId`, failure mapping and what `get_photo` returns. The answers and my corrections after review are in `NOTES.md`.

## What this server is

A Streamable HTTP MCP server that sits **in front of** the UserAuth API and calls its REST routes. It is a separate service and not part of the UserAuth backend, which stays unchanged.

| Question | Answer |
|---|---|
| Who runs it? | Me, on localhost, next to the UserAuth API (`http://localhost:3000`). |
| Who are the users? | People with a UserAuth account. Many users share one central database. |
| Which MCP clients? | The Inspector, my Day 14 agent and Claude Code. |
| Why HTTP? | Several users and personal data (name, email, photos) make per-request authentication the point of the project, and I want hands-on experience with it before building production servers. The tools themselves need no streaming. |
| Token option | **A:** the client sends the UserAuth access token on every request, and the server forwards it to the API. **B** (real OAuth) is future work. |

## The UserAuth API (read from the source)

| Item | Detail |
|---|---|
| Response format | `{ meta: { code, message }, data }`. The auth middleware's 401 is plain `{ message }`. |
| Login | `POST /auth/login` with `{ email, password }`, returns `{ user, accessToken, refreshToken }`. Access token 15 minutes, refresh token 7 days. |
| Refresh | `POST /auth/refresh` with `{ refreshToken }`. `data` is the new access token string itself. |
| Own profile | `GET /auth/me` (Bearer), returns the user with `photos`. |
| Update profile | `PATCH /user/me` (Bearer), body `{ name }`, no validation in the controller. |
| Photos | `GET /user/me/photos`, `GET /user/photos/:photoId`, `DELETE /user/photos/:photoId`, `POST /user/me/photos` (multipart, 10 files, 5 MB, JPEG, PNG or WEBP). All Bearer. |
| Photo row | `{ id, url, userId, createdAt, updatedAt }`. `url` is relative (`/uploads/...`). |
| Token payload | `{ userId }` only, HS256, no `iss` or `aud`. |
| Ownership | Checked in the API (`where: { id, userId }`, or `photo.userId !== req.userId` gives 404). |

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Transport | Streamable HTTP | See above. |
| Token source | The client sends `Authorization: Bearer` on every request. No token ever appears as a tool argument, so the model never sees it. | The model must not handle credentials. |
| Verify or forward | **Forward** the token unchanged. The API is the only verifier. | Verifying needs the shared HS256 secret and cannot check an audience, because the tokens have no `aud`. |
| Identity | No `userId` input on any tool. Identity comes only from the token. | The model controls tool arguments and can be wrong or manipulated, which would allow IDOR and prompt injection. Removing the argument means the check cannot be forgotten. |
| Output | Tools return only `data`, not the `meta` wrapper. | Less noise for the model. |
| Photo shape | `{ id, url, createdAt }` for every tool (no `userId`, since the caller always owns the photo). | One shape everywhere. |
| Photo URL | The tool prefixes `USERAUTH_BASE_URL` (an environment variable) to the relative URL. The backend is not changed. | The controllers discard the mapped URLs, and I keep the backend unchanged. |
| `get_photo` | Metadata and an absolute URL, no image bytes. | A 5 MB image as base64 would not fit in context. |
| Tool set | `get_me`, `list_photos`, `get_photo`, `update_profile`, `delete_photo` | See "Left out on purpose". |

### Day 18 changes from the roadmap
The roadmap row lists `get_profile`, `upload_photo` and `delete_photo`. I renamed `get_profile` to `get_me`, replaced `upload_photo` with `update_profile`, and keep `delete_photo`. Upload is a multipart endpoint, and an MCP tool would need the model to emit base64 bytes. So Day 18 implements `update_profile` and `delete_photo`.

## Tools

| Tool | Input | Output | Read-only | Destructive | Idempotent |
|---|---|---|---|---|---|
| `get_me` | none | `{ id, email, name, createdAt, photos }` | yes | no | yes |
| `list_photos` | none | array of photos, newest first (empty is not an error) | yes | no | yes |
| `get_photo` | `photoId` (positive integer) | one photo | yes | no | yes |
| `update_profile` | `name` (5 to 100 characters, trimmed) | the updated user | no | **yes** (it overwrites, though it is reversible) | yes |
| `delete_photo` | `photoId` (positive integer) | `{ deleted: true, photoId }`, built by the tool | no | **yes** | no (a repeat gives 404 although the end state is the same, so either value is defensible) |

Annotations are hints. The client decides whether to ask the user to confirm, so Day 18 also looks at elicitation. I set `destructiveHint` explicitly on every tool and will check the MCP defaults on the Tools page.

Descriptions are written for the model: what the tool does, who it acts for ("the signed-in user"), and for `delete_photo`: "Permanently delete one of the user's photos, including the file on disk. This cannot be undone."

## Errors: what the model sees

| Failure | What happens |
|---|---|
| Bad input | Rejected by the tool schema before any API call. |
| 400 invalid ID, 404 not found | `isError: true` with one short sentence. A missing photo and another user's photo give the same 404, so the ID's existence is not revealed. |
| 401 (expired or invalid token) | **Not a tool result.** See the decision below. |
| 5xx, network failure or timeout | The server retries a **read** once itself and never retries a **write**. Read: "The service is unavailable. Do not retry; tell the user." Write: "The change may or may not have been applied. Check current state before doing anything else." The model is never told it may retry, because a retry count enforced by the model is not reliable (Day 14). |
| Unknown tool, malformed request | JSON-RPC protocol error. |
| A bug in my own code | Logged on stderr, and a generic `isError` is returned (Day 15). |

### Decision: where an expired token is detected
The expiry is detected from the API's 401 inside the tool call, but it is surfaced as an **HTTP 401** on the MCP request, not as an `isError` result.

- **Why not `isError`:** a `200` response carrying `isError` never reaches the client's refresh logic, so the token would never refresh and the model would be told to log in every 15 minutes.
- **Why not verify at the HTTP layer:** that needs the HS256 secret in the MCP server. The API stays the only verifier.
- **How:** the server forwards the token. If the API answers 401, the server replies HTTP 401 with `WWW-Authenticate: Bearer error="invalid_token"`. This is safe because **each tool makes exactly one API call**, and a 401 means nothing ran. If a tool ever makes two calls, a 401 on the second means the first may already have run.
- **Client:** a custom client (my Day 14 agent) calls `POST /auth/refresh` with the refresh token and retries once. Only if the refresh fails does the client give the model: "Authentication required. The user needs to re-authorize this connection." A generic client such as Claude Desktop expects the OAuth flow, which is Option B.
- **Limits:** HTTP transport only. With stdio the server would have to hold the refresh token. `server/discover` and `tools/list` do not call the API, so an unauthenticated caller can list the tool names.

## Spec deviation (Option A) and Option B

The MCP authorization spec says servers **must** accept only tokens issued for them (audience check) and **must not** pass through the token they received from the client. My forwarding design breaks both rules. It is acceptable only for a local learning server, because UserAuth tokens have no `aud` claim and I keep the backend unchanged. It is **not** a production pattern.

**Option B (future):** the MCP server becomes an OAuth resource server. It returns 401 with `WWW-Authenticate` pointing at its protected-resource metadata, the client finds an authorization server and refreshes at its token endpoint, and the server validates `aud` and calls the API with its own credential. UserAuth is not an authorization server, so this means putting one in front of it, or moving to a provider such as Auth0 or Keycloak.

## Risks of a bearer token on every request

- It crosses the network each time, so TLS is required outside localhost.
- Logs, proxies and logging middleware can capture it, so redact `Authorization` and never put a token in a query string.
- A stolen token works until it expires (15 minutes), and because it has no audience it would work at any service that shares the secret.
- The refresh token (7 days) is the more valuable secret and lives in the client.

## API issues that affect the tools

- **Relative photo URLs:** the controllers compute `withFullPhotoUrl(...)` and then send the unmapped data. The tool adds the base URL itself.
- **`/uploads` is public:** any photo URL can be opened without a token by anyone who has it.
- **No validation in `updateUser`:** the tool schema protects calls through the MCP server only. The API stays open to other clients.
- **Unreachable 404 in `updateUser`:** a missing user raises Prisma `P2025`, which currently ends as a 500.
- **Inconsistent 401 shapes:** the middleware returns `{ message }` and the controllers use the `meta` envelope, so the server detects a 401 by status code only.
- **The refresh route returns a bare string** in `data`.
- **No refresh-token rotation:** the refresh token stays valid until it expires or I log out.
- **Photo rows have no content type or size.**
- The public repo's `docker-compose.yml` contains the Postgres password in plain text. Move it to `.env`.

## Left out on purpose

- **Upload:** the endpoint is multipart, and MCP tools take JSON. The model would have to emit base64 bytes (about a third bigger, through its context, often over limits), and the server cannot read files off my machine. A later option is a one-time upload URL the client posts to directly.
- **`deleteUser`:** it removes the account, cascades to every photo and deletes the files, with no soft delete and no password check. A misread request or a prompt injection could trigger it, and a `confirm: true` argument would not help, because the model can set it. If it is ever added: require the password as input, force a fresh login, mark it destructive and rely on client-side confirmation.
- **`signUp`, `login`, `refresh`, `logout`:** authentication belongs to the client layer, so the model never handles credentials or tokens.

## Open questions for Day 17

1. **Can the server turn an API 401 into an HTTP 401?** I have not verified that the SDK lets a tool handler change the HTTP status. An idea to test: record the 401 in per-request state (for example `AsyncLocalStorage`) and replace the response in a wrapper around `handler.fetch`. Fallbacks: a middleware that reads the `exp` claim without verifying it and returns 401 early, or an `isError` result with a fixed message that the client matches.
2. How does my Day 14 client attach the token and do the refresh-and-retry? The SDK's client pages on middleware and authentication may be the place. I have not read them.
3. Does the outgoing API call have a timeout, and does it pass the cancellation signal (`ctx.mcpReq.signal`)?
4. Which header does Claude Code or the Inspector send for a static token, and what happens after 15 minutes?
5. The token budget: five tools should add about 750 to 1,500 input tokens to every request. That is an estimate. Measure it.

## Not verified

- Closed on Day 17: an HTTP 401 from a handler. I did it with a flag that the tool sets and a wrapper around mcp.fetch (day-17/http-server.ts). I did not prove that the SDK has no direct way.
- Closed on Day 18: the annotation defaults and the meaning of `idempotentHint`, checked against the 2026-07-28 schema (day-18/NOTES.md, Q1).
- Partly closed on Day 18: elicitation. Inspector 2.16 asks the user on 2026-07-28 and fails closed on 2025-11-25 (real runs). A server whose client cannot ask returns a tool error and deletes nothing. My Day 14 agent was tested only in-process, and Claude Code is unknown.
- Still open: whether Claude Code or Claude Desktop can send a static `Authorization` header. Only the Inspector was tried.
- Still open, estimate only: the token budget for five tools. About 400 to 530 tokens for the definitions, estimated from characters and not counted by the API (day-18/measure.ts).

## Rules of thumb

- Identity comes from the verified token, never from a tool argument.
- A tool that takes a user ID hands the model a way to attack the data.
- An `isError` result inside a `200` response is invisible to the client's auth layer.
- Each tool makes one API call, so a 401 means nothing ran.
- Never tell the model that it may retry. Retry in code.
- Document a known deviation from the spec, so that it is a decision and not an accident.
- Annotations are hints. Confirmation is the client's job.

## Next (Day 17)

Implement `get_me`, `list_photos` and `get_photo`: call the UserAuth API with the access token, settle open question 1 first, and handle a 401 and the refresh. Check the Inspector works against the HTTP server.
