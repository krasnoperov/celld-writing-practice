import { HttpError, jsonRequest } from "./api.js";
import { PAGE, STATUS } from "./copy.js";
import { flushPendingChanges, guardDirtyPage } from "./dirty-guard.js";
import { beginIdempotentOperation, finishIdempotentOperation, retainIdempotencyAfter } from "./idempotency.js";
import { app, isDirty } from "./state.svelte.js";

const AUTOSAVE_MS = 1500;

let operation = Promise.resolve();
let pollTimer = null;
let pollDelay = 2000;
let autosaveTimer = null;

export function run(task) {
  operation = operation.then(task, task).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error?.status === 402) {
      await refreshBilling().catch(() => {});
      showBillingGate(message);
    }
    app.status = message;
  });
  return operation;
}

function showBillingGate(message = "") {
  app.gate = "billing-gate";
  if (message) app.billingMessage = message;
}

export async function refreshBilling({ reconcile = false } = {}) {
  app.billing = await jsonRequest(reconcile ? "api/billing/sync" : "api/billing/status", reconcile ? { method: "POST" } : {});
  if (!app.billing.configured) app.billingMessage = STATUS.checkoutUnconfigured;
  return app.billing;
}

async function confirmCheckout() {
  app.billingMessage = STATUS.checkoutConfirming;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await refreshBilling({ reconcile: true });
      if (app.billing.entitled) return true;
    } catch (error) {
      app.billingMessage = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

// ---- Routing: "/" is the Shelf, "/desk/:id" is the Desk. ----

function navigate(path, replace = false) {
  history[replace ? "replaceState" : "pushState"]({}, "", path);
}

function routeFromLocation() {
  const match = location.pathname.match(/^\/desk\/([a-z0-9-]+)\/?$/);
  return match ? match[1] : null;
}

export async function showShelf({ push = true, save = true } = {}) {
  if (save) await flushSave();
  clearTimeout(pollTimer);
  app.view = "shelf";
  app.pieceId = null;
  app.piece = null;
  app.editorText = "";
  app.doc = null;
  app.saveState = "saved";
  app.conflict = null;
  app.notes = [];
  app.sidebarView = "coach";
  app.mobileView = "page";
  app.activeCard = null;
  app.hotCard = null;
  await refreshPieces();
  if (push) navigate("/");
}

async function refreshPieces() {
  ({ pieces: app.pieces } = await jsonRequest("api/pieces"));
}

export async function openDesk(id, { push = true } = {}) {
  await flushSave();
  clearTimeout(pollTimer);
  app.pieceId = id;
  app.piece = await jsonRequest(`api/pieces/${id}`);
  if (!app.piece.exists) throw new HttpError("Piece not found", 404);
  app.view = "desk";
  app.sidebarView = "coach";
  app.mobileView = "page";
  app.activeCard = null;
  app.hotCard = null;
  app.arrival = null;
  app.ask = "";
  app.pendingAsk = "";
  await Promise.all([loadPage(), loadStream()]);
  if (push) navigate(`/desk/${id}`);
  pollDelay = 2000;
  schedulePoll();
}

async function loadPage() {
  const response = await fetch(`api/pieces/${app.pieceId}/docs/draft`, { cache: "no-store" });
  if (!response.ok) throw new HttpError("Could not load the page", response.status);
  app.doc = { markdown: await response.text(), revision: Number(response.headers.get("X-Document-Revision")) };
  app.editorText = app.doc.markdown;
  app.saveState = "saved";
  app.conflict = null;
}

async function loadStream() {
  const { notes } = await jsonRequest(`api/pieces/${app.pieceId}/stream`);
  const previousLatestMargin = [...app.notes].reverse().find((note) => note.kind === "margin")?.id;
  app.notes = notes;
  const latest = [...notes].reverse().find((note) => note.kind === "margin");
  if (latest && latest.id !== previousLatestMargin && !latest.seenAt) {
    const count = latest.cards.filter((card) => !card.dismissed).length;
    if (count) app.arrival = { count, stagger: Math.min(130, Math.round(2000 / count)), playing: false };
  }
}

// ---- The page: autosave with the existing revision/412 contract. ----

export function pageEdited() {
  app.lastInputAt = Date.now();
  app.saveState = "dirty";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => run(saveDraft), AUTOSAVE_MS);
}

export async function flushSave() {
  clearTimeout(autosaveTimer);
  const result = await flushPendingChanges({
    isDirty,
    save: saveDraft,
    isBlocked: () => Boolean(app.conflict),
  });
  if (result.reason === "blocked") throw new HttpError(PAGE.conflict, 412);
  if (!result.saved) throw new HttpError("Your latest changes are still saving. Try again before leaving the page.", 409);
}

export async function saveDraft() {
  if (!app.pieceId || !app.doc || !isDirty()) return;
  const body = app.editorText;
  app.saveState = "saving";
  const response = await fetch(`api/pieces/${app.pieceId}/docs/draft`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown; charset=utf-8", "X-Document-Revision": String(app.doc.revision) },
    body,
  });
  if (response.status === 412) {
    const server = await fetch(`api/pieces/${app.pieceId}/docs/draft`, { cache: "no-store" });
    app.conflict = {
      server: { markdown: await server.text(), revision: Number(server.headers.get("X-Document-Revision")) },
      local: body,
    };
    app.saveState = "dirty";
    return;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    app.saveState = "dirty";
    throw new HttpError(payload.error || "Could not save the page", response.status);
  }
  app.doc = { markdown: body, revision: Number(response.headers.get("X-Document-Revision")) };
  app.saveState = isDirty() ? "dirty" : "saved";
}

// ---- Coach verbs and note actions. ----

export async function performAction(action, body) {
  await flushSave();
  const hasBody = body && Object.keys(body).length > 0;
  const path = `api/pieces/${app.pieceId}/actions/${action}`;
  const operation = await beginIdempotentOperation({ method: "POST", path, body: hasBody ? body : null });
  try {
    app.piece = await jsonRequest(path, {
      method: "POST",
      headers: {
        "Idempotency-Key": operation.key,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
    finishIdempotentOperation(operation);
  } catch (error) {
    if (!retainIdempotencyAfter(error)) finishIdempotentOperation(operation);
    throw error;
  }
  await refreshBilling();
  pollDelay = 2000;
  schedulePoll();
}

// The ask box: a direct question, a direct answer.
export async function sendAsk() {
  const question = app.ask.trim();
  if (!question) return;
  app.ask = "";
  app.pendingAsk = question;
  try {
    await performAction("answer", { ask: question });
  } catch (error) {
    app.pendingAsk = "";
    app.ask = question; // give the question back rather than losing it
    throw error;
  }
}

export async function markSeen(noteId) {
  const note = app.notes.find((candidate) => candidate.id === noteId);
  if (!note || note.seenAt) return;
  note.seenAt = Date.now();
  await jsonRequest(`api/pieces/${app.pieceId}/notes/${noteId}/seen`, { method: "POST" });
}

export async function setAside(noteId) {
  app.piece = await jsonRequest(`api/pieces/${app.pieceId}/notes/${noteId}/aside`, { method: "POST" });
  await loadStream();
}

export async function writeBack(noteId, body) {
  await jsonRequest(`api/pieces/${app.pieceId}/notes/${noteId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  await loadStream();
}

export async function dismissCard(noteId, index) {
  const updated = await jsonRequest(`api/pieces/${app.pieceId}/notes/${noteId}/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  app.notes = app.notes.map((note) => note.id === noteId ? updated : note);
}

export function completeArrival() {
  app.arrival = null;
}

// ---- Polling: only while the coach is working. ----

async function refreshPiece() {
  if (!app.pieceId) return;
  const hadJob = Boolean(app.piece?.activeJob);
  app.piece = await jsonRequest(`api/pieces/${app.pieceId}`);
  if (hadJob && !app.piece.activeJob) {
    app.pendingAsk = "";
    await loadStream();
  }
  schedulePoll();
}

export function schedulePoll() {
  clearTimeout(pollTimer);
  if (app.piece?.activeJob) {
    pollTimer = setTimeout(() => run(refreshPiece), pollDelay);
    pollDelay = Math.min(5000, pollDelay + 500);
  } else {
    pollDelay = 2000;
  }
}

// ---- Shelf actions. ----

export async function createPiece(input) {
  const path = "api/pieces";
  const operation = await beginIdempotentOperation({ method: "POST", path, body: input });
  let created;
  try {
    created = await jsonRequest(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key },
      body: JSON.stringify(input),
    });
    finishIdempotentOperation(operation);
  } catch (error) {
    if (!retainIdempotencyAfter(error)) finishIdempotentOperation(operation);
    throw error;
  }
  await openDesk(created.id);
}

export async function saveBrief(input) {
  app.piece = await jsonRequest(`api/pieces/${app.pieceId}/brief`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deletePiece() {
  await jsonRequest(`api/pieces/${app.pieceId}`, { method: "DELETE" });
  // Deletion is the one explicit navigation that intentionally discards the
  // page: there is no longer a destination that could accept a save.
  await showShelf({ save: false });
}

export async function checkout() {
  app.billingMessage = STATUS.checkoutOpening;
  const { url } = await jsonRequest("api/billing/checkout", { method: "POST" });
  location.href = url;
}

export async function openPortal() {
  const { url } = await jsonRequest("api/billing/portal", { method: "POST" });
  location.href = url;
}

export async function logout() {
  await jsonRequest("auth/logout", { method: "POST" });
  location.href = "/";
}

export async function deleteAccount() {
  await jsonRequest("api/account", { method: "DELETE" });
  location.href = "/";
}

export async function boot() {
  const media = matchMedia("(max-width: 56rem)");
  app.isMobile = media.matches;
  media.addEventListener("change", (event) => { app.isMobile = event.matches; });
  const { user } = await jsonRequest("auth/me");
  if (!user) {
    app.gate = "signed-out";
    return;
  }
  app.user = user;
  await refreshBilling();
  const checkoutReturn = new URLSearchParams(location.search).get("billing") === "success";
  if (checkoutReturn && !app.billing.entitled) await confirmCheckout();
  if (!app.billing.entitled) {
    app.gate = "billing-gate";
    if (checkoutReturn) app.billingMessage = STATUS.checkoutPending;
    return;
  }
  if (checkoutReturn) history.replaceState({}, "", "/");
  app.gate = "in";
  await refreshPieces();
  const routed = routeFromLocation();
  if (routed && app.pieces.some((item) => item.id === routed)) await openDesk(routed, { push: false });
  else await showShelf({ push: false });

  window.addEventListener("popstate", () => {
    const currentPath = app.view === "desk" && app.pieceId ? `/desk/${app.pieceId}` : "/";
    run(async () => {
      try {
        const id = routeFromLocation();
        if (id) await openDesk(id, { push: false });
        else await showShelf({ push: false });
      } catch (error) {
        // popstate changes the URL before application code runs. If saving
        // fails, restore the route that still owns the unsaved page.
        navigate(currentPath);
        throw error;
      }
    });
  });
  window.addEventListener("focus", () => run(async () => {
    await refreshBilling();
    if (!app.billing.entitled) showBillingGate(STATUS.subscriptionEnded);
    else if (app.view === "shelf") await refreshPieces();
  }));
  window.addEventListener("beforeunload", (event) => { guardDirtyPage(event, isDirty()); });
}
