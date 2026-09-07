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
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

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
