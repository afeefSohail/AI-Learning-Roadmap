// Write calls to the UserAuth API. Exactly one attempt: a write is never retried here.
import { ApiError, BASE_URL, UnauthorizedError } from "../day-17/userauth-client";

/**
 * The write may or may not have happened: timeout, dropped connection or a 5xx.
 * (A refused connection also lands here. It cannot be told apart from a connection that died mid-request.)
 */
export class OutcomeUnknownError extends Error {}

const timeoutMs = () => Number(process.env.USERAUTH_WRITE_TIMEOUT_MS ?? 8000);

export async function writeJson(
  method: "PATCH" | "DELETE",
  path: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs());
  let res: Response;
  try {
    res = await fetch(`${BASE_URL()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new OutcomeUnknownError(`request failed: ${(err as Error).name}`);
  }
  const parsed = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string; meta?: { message?: string } };
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status >= 500) throw new OutcomeUnknownError(`API answered ${res.status}`);
  if (!res.ok) throw new ApiError(res.status, parsed.meta?.message ?? parsed.message ?? `API answered ${res.status}`);
  return parsed.data;
}
