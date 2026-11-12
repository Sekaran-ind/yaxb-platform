// JSON calls to the Worker's /api, with its error messages.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** GET (or, with a body, POST) JSON; throws ApiError with the server's message. */
export async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(path, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong.", res.status);
  return (await res.json()) as T;
}
