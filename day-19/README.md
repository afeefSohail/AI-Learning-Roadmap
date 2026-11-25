# Day 19: Remote server over HTTP

**Week 4: MCP with a real backend**

> DRAFT written by Claude. Edit it into your own words before you push.

## What I read before coding

1. The Docker Compose documentation on networking, `ports` against `expose`, `depends_on` with a healthcheck, and `restart`.
2. My own UserAuth `docker-compose.yml` and Dockerfile: service names, ports, env vars.
3. The README of `@modelcontextprotocol/node`: `localhostHostValidation`, `hostHeaderValidation`, `originValidation`.
4. The Streamable HTTP transport page of the 2026-07-28 specification, the security warnings about binding, the Origin header and DNS rebinding. (My note on what it says is not written yet.)
5. Claude Code's docs for remote HTTP servers: `claude mcp add --transport http <name> <url>`, with `--header "Authorization: Bearer ..."` for a token.
6. What the Claude apps need for a custom remote server: not written down. Unknown.
7. My Day 17 and Day 18 `http-server.ts`, to see what was hard-coded (host `127.0.0.1`, `localhostHostValidation`, the API address).

## Questions I answered before coding

See `NOTES.md` (Q1 to Q7). Short version:

| Question | My answer |
|---|---|
| What must change for a container? | Bind `0.0.0.0` inside; check Host and Origin against loopback plus `ALLOWED_HOSTS`. |
| What does the host check stop? | DNS rebinding: a web page whose domain points at `127.0.0.1`. Browsers cannot forge Host, so it gets a 403. |
| Photo links? | `USERAUTH_BASE_URL` (inside Docker) for calls, `PUBLIC_BASE_URL` (my machine) for links. |
| Does the server need Postgres? | No. It calls only the API over HTTP, so no `depends_on`. |
| Which port interface? | `127.0.0.1:3333:3333`. Only this computer. |
| Where do tokens exist? | Client, request header, memory for one request, API. Not in the image, compose file, env or logs (to be checked, see below). |
| What does an OAuth-only client do? | Gets my 401, finds no metadata, fails. |

## What I built

In `day-19/`:

- `http-server.ts`: reads `HOST`, `PORT`, `ALLOWED_HOSTS` from the environment, checks Host and Origin, serves `GET /health` and `/mcp`, stops cleanly on SIGTERM and SIGINT.
- `Dockerfile`: `node:24-alpine`, `npm ci`, runs as the `node` user, healthcheck with `wget` on `/health`.
- `Dockerfile.dockerignore`: an allow-list. Only `package.json`, `package-lock.json`, `tsconfig.json` and `day-17`, `day-18`, `day-19` go into the build context.
- `docker-compose.yml`: one service, joined to the backend's existing network (named by `BACKEND_NETWORK`), port published on `127.0.0.1` only.
- `http-server.test.ts`: 11 tests.
- Four one-line edits to Day 17 and Day 18 (`PUBLIC_BASE_URL` for photo links, `export` for `guarded`).

```bash
export BACKEND_NETWORK=$(docker inspect user_auth_api --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker compose -f day-19/docker-compose.yml up -d --build
node --import tsx --test day-19/*.test.ts
```

## Key idea: three addresses for one API

The same API has three addresses, depending on who asks. The MCP container uses `http://user-auth:3000` (service name on the shared network). My computer uses `http://localhost:3000` (published port). The model never needs either; it gets links built from the second. One setting for each caller keeps links clickable and calls working.

## Results

### Automated tests

`day-19/http-server.test.ts`: 11 tests (config, binding, `/health`, wrong Host, allowed service name, Origin, 404, link and call addresses, SIGTERM). [Write the real count and result from your run before pushing.]

### Real stack

| Check | Result |
|---|---|
| Image build | 14 steps, build context 259 kB |
| Container state | `healthy`, `127.0.0.1:3333->3333/tcp` |
| `/health` | `{"status":"ok"}` |
| Startup log | API `http://user-auth:3000`, public URL `http://localhost:3000`, hosts `localhost,127.0.0.1,[::1]` |
| `get_me` through the container (Inspector, fresh token) | Profile returned, photo URL `http://localhost:3000/uploads/...` |
| `docker stop` | 2.3 s, exit code 0 |
| Token search (token length 143) in logs, `inspect`, image history | 0, 0, 0 |
| Container user and PID 1 | `node` (uid 1000), PID 1 is `node --import tsx day-19/http-server.ts` |
| API stopped, `list_photos` through the container | Tool error "The service is unavailable. Do not retry; tell the user.", one retry in the log |

## Findings

### 1. `/health` says the process is up, not that the API is
Checking the API inside `/health` would make Docker mark my container unhealthy whenever the API restarts. A tool call is where an API failure belongs.

### 2. Binding to loopback inside a container hides the server
`127.0.0.1` inside a container is the container's own loopback. A published port arrives on the container's network address, so it never reaches the server.

### 3. The Host check protects against browsers, not callers
A browser cannot lie about Host, so DNS rebinding fails. A script can send any Host. Against a script, the token is the only control, which is why the port is published on `127.0.0.1` only.

### 4. An allow-list ignore file kept the build context small
`Dockerfile.dockerignore` starts with `*` and re-allows only what the image needs. `.env` and `.git` never leave my machine.

### 5. A clean stop needs the process to be PID 1
The CMD runs `node` directly (`node --import tsx ...`), not through `npx`, so SIGTERM reaches the process and the handler runs. Exit code 0 in 2.3 s.

### 6. A 401 still starts OAuth discovery in the client
Remote clients that follow the specification will look for metadata this server does not have (Day 17 finding 2). Static Bearer over HTTP works for a client where I can set a header.

## Errors I hit

| Problem | Cause | Fix |
|---|---|---|
| Port 3333 in use (Day 17/18) | an earlier server was still running | stop it, or use another `PORT` |
| (Claude) SIGTERM test sometimes failed | signal handlers were registered after the server started | register handlers first |
| (Claude) failing tests left servers open and hung the run | no cleanup on failure | `try/finally` and closing connections |
| (Claude) the stop test used a random port that could clash | fixed port choice | find a free port first |

## Not verified

- Secrets: the token search of the logs, `inspect` output and image history found nothing (3 counts of 0). The image filesystem and the container's memory were not searched.
- That the server recovers after the API starts again (the recovery `list_photos` was not reported).
- `3333:3333` (open to the network) and a forged Host header from another machine.
- Claude Code with `--header`, and where it stores the token.
- What the Claude apps need for a custom remote server.
- What the 2026-07-28 Streamable HTTP page says about binding and Origin (my note is not written).
- Remote access, TLS, and OAuth in front of this server. None of this was built.
- What the extra second in the 2.3 s stop is.

## What I would change

- Put TLS and real authorization in front of the server before any non-local use.
- A `/ready` endpoint that does call the API, for monitoring but not for Docker's healthcheck.
- A test that starts the real container in CI.

## Rules of thumb

- Bind `0.0.0.0` inside the container, publish on `127.0.0.1` outside.
- One address per caller: service name for containers, `localhost` for me.
- The Host check stops browsers; the token stops everyone else.
- Health checks look at the process, not at its dependencies.
- A secret check is a command I run, not a sentence I write.

## Next (Day 20)

Not started.
