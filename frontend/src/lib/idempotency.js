const STORAGE_KEY = "writing-practice.pending-operations.v1";
const MAX_PENDING_OPERATIONS = 20;
const memoryEntries = new Map();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function storageOrNull(storage) {
  try {
    return storage ?? globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readEntries(storage) {
  const target = storageOrNull(storage);
  if (!target) return new Map(memoryEntries);
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) || "[]");
    const entries = new Map(Array.isArray(parsed) ? parsed.filter((entry) => Array.isArray(entry) && entry.length === 2) : []);
    for (const [fingerprint, key] of memoryEntries) {
      if (!entries.has(fingerprint)) entries.set(fingerprint, key);
    }
    return entries;
  } catch {
    return new Map();
  }
}

function writeEntries(storage, entries) {
  const bounded = [...entries.entries()].slice(-MAX_PENDING_OPERATIONS);
  const target = storageOrNull(storage);
  if (!target) {
    memoryEntries.clear();
    for (const [fingerprint, key] of bounded) memoryEntries.set(fingerprint, key);
    return;
  }
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(bounded));
    memoryEntries.clear();
  } catch {
    memoryEntries.clear();
    for (const [fingerprint, key] of bounded) memoryEntries.set(fingerprint, key);
  }
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function beginIdempotentOperation(input, options = {}) {
  const cryptoApi = options.cryptoApi ?? globalThis.crypto;
  if (!cryptoApi?.subtle || !cryptoApi.randomUUID) throw new Error("Secure idempotency keys are unavailable");
  const canonical = JSON.stringify(stableValue({
    method: input.method || "POST",
    path: input.path,
    body: input.body ?? null,
  }));
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const fingerprint = base64Url(new Uint8Array(digest));
  const entries = readEntries(options.storage);
  const existing = entries.get(fingerprint);
  if (existing) return { fingerprint, key: existing };
  const key = cryptoApi.randomUUID();
  entries.set(fingerprint, key);
  writeEntries(options.storage, entries);
  return { fingerprint, key };
}

export function finishIdempotentOperation(operation, options = {}) {
  const entries = readEntries(options.storage);
  entries.delete(operation.fingerprint);
  writeEntries(options.storage, entries);
}

export function retainIdempotencyAfter(error) {
  if (!Number.isFinite(error?.status)) return true;
  if (error.usageStatus === "pending") return true;
  return error.status >= 500 || [408, 425, 429].includes(error.status);
}
