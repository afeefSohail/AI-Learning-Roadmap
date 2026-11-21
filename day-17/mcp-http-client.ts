import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/** The refresh token is missing, expired or revoked: the user has to log in again. */
export class ReauthRequiredError extends Error {
  constructor() {
    super("Authentication required. The user needs to re-authorize this connection.");
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * A fetch that adds the Bearer token and, on a 401 from the MCP server, refreshes the token
 * through UserAuth's POST /auth/refresh and retries the same request once.
 * The model never sees any of this.
 */
export function authFetch(apiBaseUrl: string, tokens: Tokens): typeof fetch {
  let refreshing: Promise<void> | undefined; // one refresh at a time, even when calls run in parallel

  async function refresh(): Promise<void> {
    const res = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) throw new ReauthRequiredError();
    const body = (await res.json()) as { data?: string };
    if (typeof body.data !== "string") throw new ReauthRequiredError();
    tokens.accessToken = body.data; // the API returns the new access token as a bare string
  }

  const send = (input: string | URL | Request, init: RequestInit | undefined, accessToken: string) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
  };

  return async (input, init) => {
    const used = tokens.accessToken;
    const res = await send(input, init, used);
    if (res.status !== 401) return res;
    // Someone may already have refreshed while this request was in flight.
    if (tokens.accessToken === used) {
      refreshing ??= refresh().finally(() => (refreshing = undefined));
    }
    
    if (refreshing) {
      await refreshing;
    }
    
    return send(input, init, tokens.accessToken); // retry once; a second 401 is returned as it is
  };
}

export async function connectUserAuthMcp(mcpUrl: URL, apiBaseUrl: string, tokens: Tokens): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(mcpUrl, { fetch: authFetch(apiBaseUrl, tokens) });
  const client = new Client({ name: "userauth-agent", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return client;
}
