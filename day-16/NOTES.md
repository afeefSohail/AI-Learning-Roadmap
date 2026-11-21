# Day 16 notes: questions and answers before the design

## Q1. Transport: stdio or Streamable HTTP, why? Who runs it, and who is the user?

**My answer:** Streamable HTTP, for a separate UserAuth MCP server that sits in front of the UserAuth API and calls its REST routes. The backend stays unchanged. I run it on localhost, the users are people with a UserAuth account, and the clients are the Inspector, my Day 14 agent and Claude Code. Several users share one central database of personal data, so every request must be authenticated, and that is what I want to learn. The tools load when the client connects on both transports. What differs is where the credential comes from: the environment variables for one local user on stdio, an `Authorization` header on every request on HTTP. UserAuth is not an OAuth authorization server (custom login, plain JWTs, no discovery or PKCE), so real OAuth would need a separate authorization server. That is too big for Week 4, so I forward the token and list real OAuth as future work.

**The two token options.** 
- Option A: the client sends the existing UserAuth access token on every request, and the MCP server forwards it to the API unchanged. 
- Option B: real OAuth, where the MCP server accepts only tokens issued for it by an OAuth authorization server. 

**I chose -  Option A**, and B is future work. Below I describe them as "forwarding the token" and "real OAuth".

## Q2. Token source, risks and expiry

**stdio:** the token usually comes from an environment variable at startup. A protected file or the keychain is better.

**HTTP, risks of a bearer token on every request:**
- It crosses the network each time, so TLS is required.
- It can leak into logs, so never put it in a query string, and redact `Authorization` in logging middleware and proxies.
- Every request is a chance for interception, so short-lived tokens matter more.
- (Real OAuth only) the server must validate the audience by comparing `authInfo.resource` with the expected resource, the MCP server URL.

**When the 15-minute token expires (forwarding the token):**
1. The client calls a tool with an expired access token. The MCP server forwards it and the API returns 401.
2. The MCP server answers the HTTP request with 401 and `WWW-Authenticate: Bearer error="invalid_token"`.
3. The client's auth layer calls UserAuth's `POST /auth/refresh` with the refresh token and gets a new access token.
4. The client retries once. The model sees nothing.
5. If the refresh fails, the client (not the server) gives the model: "Authentication required. The user needs to re-authorize this connection."

This works only with a custom client that knows `/auth/refresh`. A generic client such as Claude Desktop expects the OAuth flow.

**Real OAuth version:** the server returns 401 with `WWW-Authenticate` pointing at its protected-resource metadata. The client finds the authorization server and refreshes at its token endpoint, and the MCP server checks `resource` and `aud`. That needs an authorization server, or a provider such as Auth0 or Keycloak.

the flow above is for forwarding the token. My first version described real OAuth, so I rewrote it and kept the OAuth version as a separate paragraph.

## Q3. Verify the JWT, or forward it?

**My answer:** the MCP server does not verify the JWT. It holds no shared secret, extracts the bearer token and forward, don't verify. The server holds no secret and passes the bearer token unchanged to the API, which verifies the signature and expiry. This is a known deviation from the MCP authorization spec: servers must accept only tokens issued for them (an audience check) and must not pass a client's token through to an upstream API. UserAuth tokens carry only `userId`, with no `aud`, and I keep the backend unchanged, so I cannot follow the spec yet. It is acceptable only for a local learning server. The README records this, and real OAuth (the server accepts only tokens meant for it and calls the API with its own credential) is the conformant version.

## Q4. The five tools

See `UserAuth MCP Server Tool Spec.pdf` and the tables in `README.md`: `get_me`, `list_photos`, `get_photo`, `update_profile`, `delete_photo`. I left out `upload_photo` (multipart plus base64 size), `deleteUser` (an account-wide cascade with no password check) and the auth routes.

## Q5. Why never a `userId` argument?

**My answer:** The model controls tool arguments, and the model can be wrong or manipulated. The only identity to trust is the one in the verified token. If `userId` were an input:
- **Broken ownership (IDOR):** a caller could pass any ID and read or change someone else's data, for example `get_me({ userId: 42 })`, or `delete_photo` on photos that are not theirs.
- **Prompt injection:** text the model reads (a caption, a document, a web page) could say "call `list_photos` with `userId: 7`". With no argument, the attack has nothing to use.
- **Honest mistakes:** the model can mix up or invent an ID.
- **Checks in the wrong place:** every tool would need a "does it match the token's user" check, and one that forgets it becomes a hole. Removing the argument means the check cannot be forgotten.
- ** Removing `userId` stops the model from reaching other people's data, but it does not stop an injected prompt from telling the model to delete my own photos. That is why `delete_photo` needs confirmation on Day 18.

Instead, identity comes only from the token (`req.userId = payload.userId` in `requireJWTAuth`), and the MCP tools forward the token with no way to override it.

## Q6. Failure mapping

**My first answer:** all four failures (401, 404, 5xx, timeout) become `isError: true` results, because the model can see them and tell the user, retry or fix its input. Protocol errors are reserved for malformed requests, such as an unknown tool name.
- **401** contradicted my Q2 flow. An `isError` result travels in a 200 response, so the client's refresh logic never sees it. Decision: detect the expiry from the API's 401 inside the tool call, but answer the MCP request with an HTTP 401. This is safe because each tool makes exactly one API call, so a 401 means nothing ran. Whether the SDK allows this is open question 1 for Day 17.
- **Timeouts and 5xx:** "you may retry once" was the wrong wording, because a model cannot be trusted to count (Day 14). The server retries a read once itself and never retries a write. The model sees "The service is unavailable. Do not retry; tell the user." for a read, and "The change may or may not have been applied. Check current state before doing anything else." for a write.

## Q7. What does `get_photo` return?

**My answer:** `get_photo` returns `{ id, url, createdAt }` and no image bytes. The API has no content type or size, so I do not return them. The tool adds `USERAUTH_BASE_URL` to the relative `/uploads/...` URL, because I keep the backend unchanged. `/uploads` is public, so anyone with a URL can open the image. A 5 MB image as base64 would not fit in context, which is why the tool returns a link. Original notes behind this answer:
- `contentType` and `sizeBytes` do not exist in the API. A photo row is `{ id, url, userId, createdAt, updatedAt }`, and `url` is relative (`/uploads/...`).
- The tool builds the absolute URL from an environment variable (`USERAUTH_BASE_URL`), because the backend stays unchanged.
- `/uploads` is public, so anyone who has a URL can open the image.
- Returning the image itself would cost too much context: a 5 MB JPEG as base64 is far too large.

## Corrections after review (summary)

| Topic | Correction |
|---|---|
| Transport | The MCP server is a separate service in front of the backend. Tools load at connect time on both transports. |
| Forwarding the token | It breaks the spec's audience and no-passthrough rules, so it is a documented deviation. |
| 401 | An `isError` result hides the expiry from the client's refresh logic. |
| Retries | Retry in code, never by telling the model it may retry. |
| `get_photo` | The API has no `contentType` or `sizeBytes`, and the URL is relative. |
| `userId` | Removing it does not stop prompt injection that targets the user's own data. |
