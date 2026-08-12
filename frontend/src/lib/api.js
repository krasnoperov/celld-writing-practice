export class HttpError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.status = status;
    this.reason = details.reason || null;
    this.usageStatus = details.usageStatus || null;
  }
}

export async function jsonRequest(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(payload.error || `Request failed: ${response.status}`, response.status, {
      reason: payload.reason,
      usageStatus: response.headers.get("X-Usage-Status"),
    });
  }
  return payload;
}
