// Calls the UserAuth REST API with the caller's access token and unwraps `{ meta, data }`.
// It never logs or returns the token.

export const BASE_URL = () => process.env.USERAUTH_BASE_URL ?? "http://localhost:3000";

/** The API said 401: the token is missing, expired or invalid. Nothing ran. */
export class UnauthorizedError extends Error {}
/** The API said 4xx for a business reason (400, 404). The message is safe to show the model. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
/** 5xx, network failure or timeout. */
export class UnavailableError extends Error {}

const TIMEOUT_MS = 8000;

async function once(path: string, token: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new UnavailableError(`request failed: ${(err as Error).name}`);
  }
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string; meta?: { message?: string } };
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status >= 500) throw new UnavailableError(`API answered ${res.status}`);
  if (!res.ok) throw new ApiError(res.status, body.meta?.message ?? body.message ?? `API answered ${res.status}`);
  return body.data;
}

/** GET with one retry for 5xx and network failures. A read is safe to repeat. */
export async function getJson(path: string, token: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await once(path, token, signal);
  } catch (err) {
    if (!(err instanceof UnavailableError) || signal?.aborted) throw err;
    console.error(`GET ${path} failed (${err.message}), retrying once`);
    return once(path, token, signal);
  }
}
