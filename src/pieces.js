import { errorResponse, httpError, json } from "./http.js";
import { meteredActionForRequest } from "./action-policy.js";

export function chargeableAction(request, url) {
  return meteredActionForRequest(request.method, url.pathname);
}

function pieceIdFrom(pathname) {
  return pathname.match(/^\/api\/pieces\/([a-z0-9-]+)(?:\/|$)/)?.[1] ?? null;
}

function pieceStub(env, userId, pieceId) {
  return env.COACHES.get(env.COACHES.idFromName(`github:${userId}:piece:${pieceId}`));
}

function libraryStub(env, userId) {
  return env.LIBRARIES.get(env.LIBRARIES.idFromName(`github:${userId}`));
}

function accountStub(env, userId) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(`github:${userId}`));
}

async function purgePieceUsage(env, userId, pieceId) {
  const response = await accountStub(env, userId).fetch(new Request("http://account/internal/usage/purge-piece", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Account-User-ID": String(userId) },
    body: JSON.stringify({ pieceId }),
  }));
  if (!response.ok) throw httpError(response.status, "Could not purge the deleted piece from the usage ledger");
}

async function internalRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  const init = { method: request.method, headers: request.headers };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();
  return new Request(url, init);
}

async function shelfPieces(env, userId) {
  const response = await libraryStub(env, userId).fetch(new Request("http://library/internal/pieces"));
  if (!response.ok) throw new Error("Could not load the shelf");
  return (await response.json()).pieces;
}

// Account deletion: every piece cell, then the shelf itself.
export async function deleteAllPieces(env, user) {
  const shelf = await shelfPieces(env, user.id);
  for (const piece of shelf) {
    const response = await pieceStub(env, user.id, piece.id).fetch(new Request("http://piece/api/piece", { method: "DELETE" }));
    if (!response.ok) throw httpError(response.status, `Could not delete piece ${piece.id}`);
  }
  const deletedShelf = await libraryStub(env, user.id).fetch(new Request("http://library/internal/shelf", { method: "DELETE" }));
  if (!deletedShelf.ok) throw httpError(deletedShelf.status, "Could not delete the shelf");
}

export async function handlePieces(request, env, user) {
  const url = new URL(request.url);
  const library = libraryStub(env, user.id);

  if (request.method === "GET" && url.pathname === "/api/pieces") {
    const shelf = await shelfPieces(env, user.id);
    const hydrated = await Promise.all(shelf.map(async (piece) => {
      const response = await pieceStub(env, user.id, piece.id).fetch(new Request("http://piece/api/piece"));
      const status = response.ok ? await response.json() : { exists: false };
      return { ...piece, status };
    }));
    const pieces = hydrated.filter((piece) => piece.status.exists);
    pieces.sort((left, right) => (right.status.updatedAt ?? right.createdAt) - (left.status.updatedAt ?? left.createdAt));
    return json({ pieces });
  }

  if (request.method === "POST" && url.pathname === "/api/pieces") {
    let input;
    try {
      input = await request.json();
    } catch {
      return errorResponse(httpError(400, "Request body must be valid JSON"));
    }
    const pieceId = crypto.randomUUID();
    const piece = pieceStub(env, user.id, pieceId);
    const created = await piece.fetch(new Request("http://piece/api/piece", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }));
    if (!created.ok) return created;
    const registered = await library.fetch(new Request(`http://library/internal/pieces/${pieceId}`, { method: "PUT" }));
    if (!registered.ok) {
      await piece.fetch(new Request("http://piece/api/piece", { method: "DELETE" }));
      return registered;
    }
    return json({ id: pieceId, ...(await created.json()) }, 202);
  }

  const pieceId = pieceIdFrom(url.pathname);
  if (!pieceId) return errorResponse(httpError(404, "Piece not found"));
  const piece = pieceStub(env, user.id, pieceId);

  if (request.method === "DELETE" && url.pathname === `/api/pieces/${pieceId}`) {
    const deleted = await piece.fetch(new Request("http://piece/api/piece", { method: "DELETE" }));
    if (!deleted.ok) return deleted;
    const removed = await library.fetch(new Request(`http://library/internal/pieces/${pieceId}`, { method: "DELETE" }));
    if (!removed.ok) return removed;
    await purgePieceUsage(env, user.id, pieceId);
    return json({ deleted: true });
  }

  const base = `/api/pieces/${pieceId}`;
  let internalPath;
  if (url.pathname === base) internalPath = "/api/piece";
  else if (url.pathname === `${base}/brief`) internalPath = "/api/brief";
  else if (url.pathname === `${base}/stream`) internalPath = "/api/stream";
  else if (url.pathname === `${base}/docs/draft`) internalPath = "/api/docs/draft";
  else if (url.pathname.startsWith(`${base}/notes/`)) internalPath = `/api${url.pathname.slice(base.length)}`;
  else if (url.pathname.startsWith(`${base}/actions/`)) internalPath = `/api${url.pathname.slice(base.length)}`;
  else return errorResponse(httpError(404, "Route not found"));
  return piece.fetch(await internalRequest(request, internalPath));
}
