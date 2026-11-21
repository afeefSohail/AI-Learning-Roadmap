# Day 17: Read tools

**Week 4: MCP with a real backend**

## What I read before coding

1. The v2 SDK [Authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.md) page again, looking for `authInfo`, `requireBearerAuth` and `ctx.http`. Today's code reads the `Authorization` header directly and does not use them.
2. The [serving over HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) page: `createMcpHandler`, the factory that runs once per request, and `responseMode`.
3. The README of `@modelcontextprotocol/node`: `toNodeHandler` and `localhostHostValidation`.
4. My Day 16 README, "Open questions for Day 17".
5. My own `requireJWTAuth` and the `getMe` and photo controllers, to see what each route returns.

## Questions I answered before coding

See `NOTES.md` (Q1 to Q5). Short version:

| Question | My answer |
|---|---|
| Why read the token per request and not store it in a variable? | A shared variable lets one user's request overwrite another's token while a call is waiting on the API. |
| What does a 2025-era client get if the response streams before the tool finishes? | HTTP 200, so a client watching the status never refreshes. |
| Three parallel calls with an expired token: how many refreshes? | One, shared through a single promise, plus a stale-token check. |
| The refresh token has expired: who says what? | The client gives up with `ReauthRequiredError`, and the app asks the user to log in. |
| Why not retry writes? | A 500 does not say whether the write happened. |

## What I built

All in `day-17/`:

- `userauth-client.ts`: calls the UserAuth REST API with the token. A 401 becomes `UnauthorizedError`, a 5xx or a failed connection becomes `UnavailableError`, other errors become `ApiError`. Reads are tried once more after `UnavailableError`. Every request has an 8 second timeout.
- `create-server.ts`: `createServer(ctx)` reads the `Bearer` token from the request headers and registers three tools: `get_me`, `list_photos`, `get_photo`. All three are annotated read-only. None has a `userId` or a token as input.
- `http-server.ts`: Streamable HTTP on `127.0.0.1:3333/mcp`. A wrapper turns "the API said 401" into a real HTTP 401 with `WWW-Authenticate`.
- `mcp-http-client.ts`: a client `fetch` that adds the token and, on a 401, refreshes it once (shared by all parallel calls) and retries once.
- `mock-api.ts`, `server.test.ts`, `client.test.ts`: 15 tests against a mock API.

```bash
export USERAUTH_BASE_URL=http://localhost:3000
npx tsx day-17/http-server.ts
node --import tsx --test day-17/*.test.ts
```

## Key idea: a tool has one API call, so a 401 means nothing ran

Each tool makes exactly one request. If the API answers 401, no work was done, so the server can answer the whole HTTP request with a 401 and the client can refresh and retry safely. The model never sees the token, never chooses a user, and is never told it may retry.

## Results

### Automated tests: 15 of 15 pass

| Group | Tests |
|---|---|
| Refresh on 401 | refreshed once and the caller does not notice; parallel calls trigger one refresh; a dead refresh token ends in `ReauthRequiredError` |
| Read tools | list shows three tools with no `userId` or token input; `get_me` shape; `list_photos` order and empty list; `get_photo`; same 404 for someone else's photo and a missing one; bad ID rejected before any API call |
| 401 handling | expired token becomes HTTP 401; a 2025-era request also gets the 401; no token: `tools/list` works, a tool call is a 401 and makes no API call |
| API failures | a 500 on a read is retried once and then the model is told not to retry; one transient 500 is hidden; the token never appears in a tool result |

### Real API with the MCP Inspector 2.16.0

| Check | Result |
|---|---|
| Connect with `Authorization: Bearer <token>` in the Custom Headers section | Connected, protocol version shown as `MCP 2025-11-25` |
| `get_me` | Profile with `id`, `email`, `name`, `createdAt`, `photos` (absolute URLs). No token, no `updatedAt`. |
| `list_photos` | List with my one photo |
| `get_photo` with my photo ID | The photo |
| `get_photo` with ID 9999 | `isError: true`, "Photo not found" |
| `get_photo` with 0 and -1 | `isError: true`, "Input validation error ... Too small: expected number to be >0", no API call |
| UserAuth API container stopped, `list_photos` | `isError: true`, "The service is unavailable. Do not retry; tell the user." |
| Wrong token, `get_me` | The Inspector showed "Dynamic Client Registration rejected (HTTP 404)" |
| MCP server itself stopped, any tool | No tool result at all, only the error "fetch failed" |
| Token in terminal output or shell history | None found |

## Findings

### 1. The Inspector has a place for headers
Inspector 2.16.0 has a Custom Headers section (Key and Value fields) on each server. The help text says a custom `Authorization` header is sent until OAuth produces a token, then the SDK sends the OAuth token instead. Changes apply on the next connect.

### 2. A 401 makes a spec-following client start OAuth
When my server answered 401, the Inspector did not show "invalid token". It looked for an authorization server and tried Dynamic Client Registration on my server, got a 404 and showed only that. The real cause (a wrong token) is hidden behind it. This is the price of the forwarding design from Day 16: the server speaks like an OAuth resource server but has no authorization server behind it.

### 3. "Connected" proves nothing about the token
`tools/list` works with no token, so the green dot appears even with a wrong or missing token. Only a tool call checks it.

### 4. The Inspector speaks the 2025 protocol
It negotiated `2025-11-25`, so its requests use the SDK's legacy path, the one where the response is streamed before the tool runs. My POST buffering is exercised by real use, not only by a test.

### 5. The two "server is down" cases look different
If the API is down, the model gets a clean tool error. If my MCP server is down, there is no tool result at all, only a transport error from the client. Agents need to handle both.

### 6. Why `AsyncLocalStorage` exists
The factory carries the token into the tools. `AsyncLocalStorage` carries the "API said 401" flag out of the tool to the HTTP wrapper, because the SDK gives the wrapper only a finished `Response`. They solve different problems in opposite directions.

### 7. Mutation checks showed the tests can fail
Removing the shared refresh promise failed the parallel-refresh test. Removing the POST buffering made the 2025-era request return 200 instead of 401.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| Opening `http://127.0.0.1:3333/mcp` in the browser gave "Method not allowed" | The browser sent GET, and the stateless server accepts POST | Put the URL in the Inspector, not the browser |
| `fetch failed` in the Inspector | I stopped the MCP server, not the API container | Stop the API container with `docker compose stop` |
| (Claude) 2025-era request returned 200 | The stream was returned before the tool ran | Buffer POST responses before checking the flag |
| (Claude) parallel refresh test passed without the shared promise | All refreshes were instant | Added a 150 ms delay to the mock refresh |

## Not verified

- Why I might prefer `authInfo` / `requireBearerAuth` over reading the header myself (reading item 1). My answer is not written yet.
- Claude Code with `claude mcp add --transport http --header ...`, and where it stores the header.
- The stale-token branch of the client refresh (a 401 that arrives after the refresh has finished). No test covers it.
- A client refresh against the real API. The Inspector does not refresh, and my refresh client was tested only against the mock.
- Whether the "retrying once" log line appeared for the API-stopped test on the real stack.
- Whether a `WeakMap` keyed by the request could replace `AsyncLocalStorage`.
- How cancellation travels on the wire in the 2026 protocol.
- Annotation defaults and elicitation over stateless HTTP (carried from Day 16).

## What I would change

- Return an unambiguous error when a client starts OAuth discovery, so a wrong token is not hidden behind a 404.
- Add a test for the stale-token path.
- Day 18: `responseMode: "json"` and my buffering drop messages sent during a call. A confirmation step for `delete_photo` through elicitation needs a different approach, so decide this before writing the tool.

## Rules of thumb

- Identity comes from the token only. No tool takes a `userId`.
- One API call per tool, so a 401 means nothing ran.
- Retry reads in code, never writes, and never tell the model it may retry.
- The client refreshes tokens, not the model and not the MCP server.
- A green "Connected" does not mean the credentials work.

## Next (Day 18)

Write tools, safely: `update_profile` and `delete_photo`, destructive annotations, confirmation, ownership checks on the API side, and tests.
