export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function errorResponse(error, fallbackStatus = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, error?.status || fallbackStatus);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Request body must be valid JSON");
  }
}
