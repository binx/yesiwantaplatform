/** Thin fetch wrapper that surfaces the API's error messages to the UI. */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to a generic message.
  }
  return `Request failed (HTTP ${response.status}).`;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...(signal ? { signal } : {}),
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

/**
 * A public write — checkout, which any visitor may perform.
 *
 * Deliberately does not fetch a CSRF token. Doing so would mean a
 * `GET /api/session` for every shopper, and since issuing a token writes to
 * the session that would put a row in the session table for every anonymous
 * visitor — the thing `saveUninitialized: false` exists to prevent.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

/* --------------------------------------------------------- privileged writes */

/**
 * The session's CSRF token.
 *
 * The server issues one per session and requires it in `x-csrf-token` on every
 * state-changing request. Holding it in a module variable rather than a cookie
 * is the point: a synchroniser token that script on another origin cannot read
 * is what makes the check worth having.
 */
let csrfToken: string | null = null;
let pending: Promise<string> | null = null;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = null;
  pending = null;
}

/** Fetch a token, coalescing concurrent callers onto a single request. */
async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;

  pending ??= apiGet<{ csrfToken: string }>("/session").then(
    (session) => {
      csrfToken = session.csrfToken;
      pending = null;
      return session.csrfToken;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );

  return pending;
}

type Method = "POST" | "PUT" | "DELETE";

function send(method: Method, path: string, body: unknown, token: string): Promise<Response> {
  return fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "x-csrf-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * A write carrying the session's CSRF token — admin routes and setup.
 *
 * A 403 is retried exactly once against a freshly fetched token, because the
 * usual cause is a token that went stale: the server regenerates the session
 * on login and on completing setup, so a tab holding the previous one is a
 * normal occurrence rather than an attack. Retrying more than once would turn
 * a genuine rejection into a loop.
 */
async function csrfSend<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response = await send(method, path, body, await ensureCsrfToken());

  if (response.status === 403) {
    clearCsrfToken();
    response = await send(method, path, body, await ensureCsrfToken());
  }

  if (!response.ok) throw new ApiError(await readError(response), response.status);

  // 204 is the normal success for updates, reorders and deletes.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const csrfPost = <T>(path: string, body?: unknown): Promise<T> =>
  csrfSend<T>("POST", path, body);
export const csrfPut = <T>(path: string, body?: unknown): Promise<T> =>
  csrfSend<T>("PUT", path, body);
export const csrfDelete = <T>(path: string, body?: unknown): Promise<T> =>
  csrfSend<T>("DELETE", path, body);

/**
 * Upload one file as multipart.
 *
 * `content-type` is deliberately left unset so the browser writes the
 * multipart boundary itself.
 */
export async function csrfUpload<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const attempt = async (token: string) => {
    // Rebuilt per attempt: a FormData body is a stream and cannot be re-sent.
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    return fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "x-csrf-token": token },
      body: form,
    });
  };

  let response = await attempt(await ensureCsrfToken());

  if (response.status === 403) {
    clearCsrfToken();
    response = await attempt(await ensureCsrfToken());
  }

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}
