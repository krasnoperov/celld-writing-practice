export const PIECE_PROVIDER_ACTIONS = Object.freeze([
  "read",
  "letter",
  "verdict",
  "margin",
  "answer",
]);

export const METERED_PROVIDER_ACTIONS = Object.freeze([
  "initial_read",
  ...PIECE_PROVIDER_ACTIONS,
]);

const pieceProviderActions = new Set(PIECE_PROVIDER_ACTIONS);

export function isPieceProviderAction(action) {
  return pieceProviderActions.has(action);
}

export function meteredActionForRequest(method, pathname) {
  if (method !== "POST") return null;
  if (pathname === "/api/pieces") return { action: "initial_read", pieceId: null };
  const match = pathname.match(/^\/api\/pieces\/([a-z0-9-]+)\/actions\/([a-z_]+)$/);
  if (!match || !isPieceProviderAction(match[2])) return null;
  return { action: match[2], pieceId: match[1] };
}
