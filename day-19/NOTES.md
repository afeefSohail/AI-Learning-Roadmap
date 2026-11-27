# Day 19 notes: the MCP server in Docker, reachable over HTTP

## Reading notes: Compose basics

**Published Port:**
When you read `127.0.0.1:3000:3000` from left to right, it moves from your computer into the container:
• `127.0.0.1` (Host Address): The local IP address on your computer.
• `3000` (Host Port): The port open on your computer.
• `3000` (Container Port): The port your application is listening on inside the container.

- **Service names:** `docker compose up` creates one bridge network, `<project>_default`, and attaches every service to it. Services reach each other by service name. No `networks:` block is needed inside one project.
- **`ports` vs `expose`:** `ports` publishes a container port on the host (`3001:3000` is host port : container port). `expose` has no host port; it only marks a container port as internal. I use `ports` for things I call from my laptop and keep databases and caches unpublished.
- **`depends_on`:** by default it waits only until the dependency has *started*. With `condition: service_healthy` and a `healthcheck` on the database, the API waits until the database is ready.
- **`restart`:** `no` (default) never restarts. `on-failure` restarts only on a non-zero exit. `unless-stopped` restarts on a crash or daemon reboot, unless I stopped it by hand. `always` restarts even a container I stopped by hand, when the Docker daemon restarts.
- **Publish `-p 127.0.0.1:3333:3333`:** host address (the interface on my computer), host port (the port open on my computer), container port (where the app listens inside the container). Docker forwards traffic from the first two to the third, on the container's own network address.
- `expose` does not open or close anything. Containers on the same Docker network can reach *every* port a container listens on, whether it is exposed or not. `expose` is documentation. What keeps a database private is that it has no `ports:` entry and sits on a network the other side is not on.
- `ports` without a host address (`3333:3333`) publishes on every interface of my computer, not only "the network". `127.0.0.1:3333:3333` limits it to my computer.
- The `Dockerfile` here never says `EXPOSE`, and the server still works. That is the same point.

## Q1. Binding and hosts: what changes for a container?

**My answer:**
- **Bind `0.0.0.0` inside the container.** A server bound to `127.0.0.1` listens only on the container's own loopback, so a published port cannot reach it. The Dockerfile sets `HOST=0.0.0.0`.
- **Allow more Host names.** `localhostHostValidation()` accepts only loopback names. Day 19 uses `hostHeaderValidation` and `originValidation` with the loopback names plus whatever `ALLOWED_HOSTS` adds.
- **Host values the server sees:** `localhost:3333` and `127.0.0.1:3333` through the published port, always allowed.
- **Attack stopped: DNS rebinding.** A web page on `abc.com` makes its domain resolve to `127.0.0.1`, then sends requests to my local server from the browser. The request carries `Host: abc.com`, and the host check answers 403. The Origin check blocks cross-site browser requests the same way.

- The names are `hostHeaderValidation` and `originValidation`, not `validateHost` and `validateOrigin`. Both take host names without the port.
- Another container calling this one by service name (for example `mcp:3333`) would send `Host: mcp:3333` and get a 403 until `mcp` is in `ALLOWED_HOSTS`. This answers "which Host values" more completely: the loopback names for me, and the service name only if I add it. Only the first case exists today.
- The host check protects against **browsers**, which cannot choose their Host header freely. `curl -H "Host: localhost"` from another machine passes it. The token is what stops non-browser callers. That matters in Q4.
- What changed for each setting, in the table form the question asked for:

| Change | What it allows that was blocked before |
|---|---|
| `HOST=0.0.0.0` | the published port reaches the server inside the container |
| `ALLOWED_HOSTS` | a Host name other than loopback (a service name, a LAN name) is accepted |
| `hostHeaderValidation` + `originValidation` | explicit control over which names pass, instead of loopback only |

## Q2. Photo URLs: will the client open them?

**My answer:** No. `USERAUTH_BASE_URL=http://user-auth:3000` works only inside the Docker network, so a photo link built from it would not open on my computer. `USERAUTH_BASE_URL` is where the MCP container *calls* the API. The fix is a second setting, `PUBLIC_BASE_URL=http://localhost:3000`, used only to build the links the user will open.

**Real result:** `get_me` through the container returned `http://localhost:3000/uploads/...`, while the call itself went to `user-auth:3000`.

- The service name is `user-auth` (container `user_auth_api`), not `api`.
- `localhost:3000` only works when the client runs on the same computer as the Docker host. A remote client would need a real public address for the API, and that is a different deployment question that I did not test.
- The tests check both directions: links use `PUBLIC_BASE_URL`, calls use `USERAUTH_BASE_URL`.

## Q3. Which services does the server need? What if the API is down at start?

**My answer:** The MCP server never talks to Postgres. It calls the API over HTTP. So there is no `depends_on` in the compose file, and `depends_on` could not point at a service in another compose project anyway. The shared network does that job.

If the API is down when the container starts, the container still starts and `/health` passes, because `/health` makes no API call. A tool call then fails after one retry (reads only) with `isError: true` and "The service is unavailable. Do not retry; tell the user." That is a tool error, not a 401.

- The statement "never talks to Postgres" comes from the code: the only outbound calls are `getJson` and `writeJson` to the API. I did not test it by cutting the database.
- **Run on 2026-11-25:** with `user_auth_api` stopped, `list_photos` through the container returned `isError: true` and "The service is unavailable. Do not retry; tell the user." The server log showed `GET /user/me/photos failed (request failed: TypeError), retrying once`, then `userauth api unavailable: request failed: TypeError`. So the read was retried once and then the model was told not to retry, as designed. The `TypeError` is what `fetch` throws when it cannot connect (the name `user-auth` no longer answers). The log also showed the earlier `stopping` line from the `docker stop` test, which confirms the SIGTERM handler ran.
- `/health` answering says the *process* is up. It says nothing about the API. That is deliberate: if `/health` called the API, Docker would mark the MCP container unhealthy every time the API restarts.

## Q4. Publishing the port: which interface?

**My answer:** `127.0.0.1:3333:3333`. Docker binds the port to loopback only, so only programs on this computer can call it. The Host check and the API token apply on top.

With `3333:3333` anyone on the network could reach the port. A LAN client's Host would be an IP or a name that is rejected unless it is in `ALLOWED_HOSTS`, and the token still applies.

- Who can call it, and what stops them:

| Case | Who can reach the port | What stops them |
|---|---|---|
| `127.0.0.1:3333:3333` | programs on this computer | the interface binding; then the token |
| `3333:3333` | anyone who can reach this computer | only the token, for a caller who sets its own Host header; the Host check stops browsers and clients that send their real Host |
| any case, a web page in my browser | a browser on this computer | the Host and Origin checks (DNS rebinding), then the token |

- I wrote that the Host check stops LAN callers. It stops one who connects as `192.168.x.x:3333` without changing headers. A caller who writes `Host: localhost` gets past it. The token is the real control, and without a token `tools/list` still works (Day 17 finding 3). That is why 127.0.0.1 is the better default.
- I did not test `3333:3333`.

## Q5. Secrets: where do tokens exist?

**My answer:**
- In the client: the tokens object in `authFetch`.
- In flight: the `Authorization` header on each request.
- In the container: in memory for the length of one request.
- At the API.

Not in the image (the Dockerfile has no token, and `.env` and every other file that could hold one are excluded by `Dockerfile.dockerignore`), not in the compose file (URLs only), not in an env var (no token variable exists), not in the logs (the code logs error names and messages, never the token).

**How to check:**
```bash
docker history --no-trunc userauth-mcp-mcp
docker inspect userauth_mcp --format '{{.Config.Env}}'
docker logs userauth_mcp 2>&1 | grep -i -E "bearer|eyJ"
```
and a call with a known token, then a search of the logs for exactly that token.

- The image name is `userauth-mcp-mcp` (project `userauth-mcp`, service `mcp`), not `userauth-mcp`.
- **Result of the run (2026-11-25):** with a real access token in the shell (length 143, checked before the greps), `grep -c -F` gave `0` for `docker logs userauth_mcp`, `0` for `docker inspect userauth_mcp` and `0` for `docker history --no-trunc userauth-mcp-mcp`. Two earlier runs were invalid and are not counted: one had an empty variable (the counts were just the line counts, 5, 288 and 22), and one used a 20-character string that was not the token.
- **What the result proves, and what it does not:** it shows the token is not in the image history, the container's configuration or the logs. The code logs only error names and messages, so an empty logs result is what I expected, and it is weaker evidence than the code itself. The `inspect` and `history` checks would be `0` for any token created after the build. I did not search the image filesystem or the running container's memory.
- The client side also stores the token somewhere (the Inspector's header field, or Claude Code's config if I use `--header`). I did not check where. Unknown.

## Q6. Remote and authentication: which clients can connect, and what would an OAuth client do?

**My answer:**
- **MCP Inspector:** can send custom headers (verified on Day 17 and again today). OAuth: unknown.
- **Claude Code:** the docs show `claude mcp add --transport http <name> <url>` and the same command with `--header "Authorization: Bearer your-token"`. Not run by me.
- **Claude app:** unknown. I did not write down what its page says.

A client that requires real OAuth would get my 401, look for protected-resource and authorization-server metadata, get 404 for both, and fail. My server has no authorization server, no client registration and no token endpoint.

- The Inspector already showed this: on a bad token it started discovery and reported "Dynamic Client Registration rejected (HTTP 404)". So the failure is observed, not only predicted.
- The question had three clients, and the answer covers one fully. For Claude Code the docs say the header form exists. Whether it works against this server, and where it stores the header, is **unknown** until it is run. For the Claude app I have no confirmed answer, so the table below says unknown.

| Client | Static Bearer header over HTTP | Real OAuth against this server |
|---|---|---|
| MCP Inspector 2.16 | Verified | Fails (observed: DCR 404) |
| Claude Code | Documented, not run | Unknown |
| Claude app | Unknown | Unknown |

## Q7. Tests: which checks prove it works?

**Written by Claude from what exists; restate in my own words.**

Automated (`day-19/http-server.test.ts`, 11 tests):
- config defaults, and `ALLOWED_HOSTS` adds names to loopback;
- binding: the server listens on the configured host;
- `/health` returns `{"status":"ok"}`;
- a wrong Host header is rejected with 403, a configured service name is accepted;
- the Origin check rejects a foreign origin;
- any path other than `/mcp` and `/health` is 404;
- photo links use `PUBLIC_BASE_URL` while the API is called at `USERAUTH_BASE_URL`;
- SIGTERM stops the process cleanly.

Manual, on the real stack, 2026-11-25:

| Check | Result |
|---|---|
| `docker compose up -d --build` | Built (14 steps, context 259 kB) |
| `docker compose ps` | `healthy`, `127.0.0.1:3333->3333/tcp` |
| `curl http://127.0.0.1:3333/health` | `{"status":"ok"}` |
| Startup log | `listening on 0.0.0.0:3333/mcp (API: http://user-auth:3000, public URL: http://localhost:3000, hosts: localhost,127.0.0.1,[::1])` |
| Inspector `get_me` through the container | Profile returned, photo URL starts with `http://localhost:3000/` |
| `time docker stop userauth_mcp` | 2.3 s, exit code 0, restarted with `up -d` |

| API stopped, `list_photos` through the container | `isError: true`, "The service is unavailable. Do not retry; tell the user."; log shows one retry |
| `docker exec userauth_mcp id` | `uid=1000(node) gid=1000(node)` |
| `docker exec userauth_mcp ps` | PID 1 is `node --import tsx day-19/http-server.ts`, owned by `node` |
| Token search in logs, `inspect`, image history (token length 143) | 0, 0, 0 |

Not run: a wrong Host header from outside the test suite, `3333:3333` (open to the network), Claude Code with a static header, the recovery `list_photos` after the API was started again.
