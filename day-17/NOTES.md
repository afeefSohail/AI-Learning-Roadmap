# Day 17 notes: answers before running the code

## Q1. Why read the token from the request inside the factory, and not keep it in a module-level variable?

**My answer:** A module-level variable is shared by every concurrent request in the process. Because `await` interleaves requests, user B's request can overwrite the token while user A's tool call is waiting on the API. A's call then uses B's token, which leaks B's data to A. The factory avoids this by reading the token from the request and creating a new server instance per request, with the tools registered inside it as closures over that token. Nothing is kept between requests, and no two requests can see each other's token. An alternative is `AsyncLocalStorage`, which gives each async call chain its own context.

## Q2. What does a 2025-era client receive if the response is streamed before the tool finishes?

**My answer:** It receives HTTP 200, not 401. In the 2025 era, once the server sends the response headers, the status line is committed. The answer is a 200 with `Content-Type: text/event-stream`, and the failure travels only as a JSON-RPC message on the stream (an `isError` result or a JSON-RPC error), or the stream closes with no result. A client whose refresh logic watches the HTTP status never refreshes. This is the same failure as the `isError` problem from before.

the outcome is right, and my test showed 200 with `event: message`. The mechanism in my code is different from "setting a 401 after the headers are sent". The wrapper checks the flag when the handler returns the streamed response, and at that moment the tool has not run yet, so the flag is still false. The wrapper then returns the 200 unchanged. Nothing throws. The fix is to read a POST's whole response before checking the flag.

## Q3. Three parallel calls with an expired token: how many refreshes, and what is needed?

**My answer:** One refresh, not three. All three requests fail with 401 at the same time, so the client needs a single refresh that everyone shares. The first request asks for a new token, and the others wait for that answer: one refresh at a time, shared by everyone who needs it.

Two parts are needed, and I wrote them down:
1. **A shared promise** (single-flight): `refreshing ??= callRefreshEndpoint().then(...).finally(() => (refreshing = null))`.
2. **A stale-token check:** remember which token the request was sent with. If `currentToken` is already different when the 401 arrives, another call has refreshed, so use the new token and do not refresh again. Without it, a 401 that arrives after the refresh has finished and the promise has been cleared would start a second refresh.

```ts
async function callTool(req) {
  const sentWith = currentToken;
  let res = await send(req, sentWith);
  if (res.status === 401) {
    const token = sentWith !== currentToken ? currentToken : await getFreshToken();
    res = await send(req, token); // retry once
  }
  return res;
}
```

**Review note (from Claude, not yet in my own words):** the day-17 client has both parts. My parallel test fails when I remove the shared promise (I checked this). It does not exercise the stale-token path, because all three requests get their 401 before the refresh finishes. That path is untested.

## Q4. The refresh token has expired: which layer says what to whom, and what does the model see?

**My answer:**
1. API (401, the access token expired) → MCP server (HTTP 401 with `WWW-Authenticate`) → MCP client (`POST /auth/refresh`) → API (401, "invalid or expired refresh token") → MCP client gives up, with no retry of the tool call → the model is told to tell the user → the user or the client app opens the login screen.
2. The model sees a tool error, `isError: true`, with the short message "Authentication required". Whether the model sees it at all is the agent's choice.

the chain is right, with two clarifications. The refresh call goes from the client straight to the UserAuth API, not through the MCP server. And in my code, the client throws `ReauthRequiredError`. Whether the model sees it at all is the agent's decision: the agent can turn the error into a `tool_result` for the model, or stop the loop and show a login screen itself. The model cannot open the login screen. I would stop the loop, so that the model does not keep trying other tools with a dead login.

## Q5. Why not retry writes, and what if the user cancels during the retry?

**My answer:**
1. A 500 does not say whether the write happened. I do not know if the API failed before the database, after the commit, or before answering me. A read is harmless to repeat because it has no side effect.
2. If the user cancels before the retry or while it waits, stop immediately and do not send the retry. The client sends a cancellation, and the server aborts when `ctx.mcpReq.signal.aborted` is true.

the retry in my code has no waiting period, but it does check the signal before it retries, and it passes the signal to `fetch`. How the cancellation travels is something I have not verified. On Day 15, in-process over HTTP, a client timeout aborted the handler's signal. I did not check whether the wire message is `notifications/cancelled` or a closed connection in the 2026 protocol, so I do not state it as a fact.

## Carried from Day 17: why `authInfo` and `requireBearerAuth` instead of reading the header myself

**Source:** the v2 SDK Authorization page.

What the page says:
- `requireBearerAuth` is the gate in front of the MCP route. A missing, malformed or expired token gets 401 `invalid_token`, and a valid token without a required scope gets 403 `insufficient_scope`. Both carry a `WWW-Authenticate: Bearer` challenge.
- I supply `verifyAccessToken(token)`, which returns an `AuthInfo`. It can verify a JWT locally, use introspection, or ask an identity provider. The result reaches my tools as `ctx.http.authInfo`.
- `expectedResource` accepts only tokens issued for this server, and my verifier must fill `AuthInfo.resource` from the token's `aud`.
- `mcpAuthMetadataRouter` serves the RFC 9728 document that the 401 points to.
- The page does not say "use this instead of the header". It only shows what the gate does for me.

Why I might prefer it (my inference):
1. The check runs before any tool, so `tools/list` would no longer work without a token.
2. The SDK sends the 401 and its challenge, which can carry `resource_metadata`. Mine sends only `error="invalid_token"`.
3. Audience checking, the fix for token passthrough in Q3, becomes one option.
4. My buffering and `AsyncLocalStorage` trick exists only because the API decides a token is bad. A gate that verifies first would make it unnecessary for the missing-token case.

Cost: my server cannot verify a token itself. `verifyAccessToken` would have to call the API (for example `GET /auth/me`, one more request per call) or hold the signing secret, which breaks "no secrets in the container". I have not checked the exact export name for the web-standard version of the gate.