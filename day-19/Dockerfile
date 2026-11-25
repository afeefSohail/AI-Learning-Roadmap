# The UserAuth MCP server (Day 19). Build from the repository root:
#   docker build -f day-19/Dockerfile -t userauth-mcp .
FROM node:24-alpine

WORKDIR /app

# Dependencies first, so this layer is cached until package.json or the lock file changes.
# --ignore-scripts: do not run postinstall hooks (the repo has Prisma, which this server does not use).
# tsx is a devDependency, so dev dependencies stay in the image. See "What I would change" in the README.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY day-17 ./day-17
COPY day-18 ./day-18
COPY day-19 ./day-19

# Listen on every interface INSIDE the container. The compose file decides who can reach the published port.
ENV HOST=0.0.0.0 \
    PORT=3333 \
    NODE_ENV=production

# Do not run as root.
USER node

EXPOSE 3333

# /health needs no token and makes no API call, so it says whether this process is up, not whether the API is.
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3333/health || exit 1

# node itself is PID 1 (no npx in between), so it receives SIGTERM from `docker stop`.
CMD ["node", "--import", "tsx", "day-19/http-server.ts"]
