import { json } from "./http.js";

const STATE_KEY = "shelf";
const MAX_PIECES = 50;

export class WritingLibrary {
  constructor(state) {
    this.state = state;
  }

  async load() {
    return (await this.state.storage.get(STATE_KEY)) ?? { pieces: [] };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/internal\/pieces\/([a-z0-9-]+)$/);
    const shelf = await this.load();

    if (request.method === "GET" && url.pathname === "/internal/pieces") {
      return json({ pieces: [...shelf.pieces].sort((left, right) => right.createdAt - left.createdAt) });
    }

    if (request.method === "PUT" && match) {
      if (shelf.pieces.some((piece) => piece.id === match[1])) return json({ error: "This piece is already on the shelf" }, 409);
      if (shelf.pieces.length >= MAX_PIECES) return json({ error: `A shelf can hold at most ${MAX_PIECES} pieces` }, 409);
      const piece = { id: match[1], createdAt: Date.now() };
      shelf.pieces.push(piece);
      await this.state.storage.put(STATE_KEY, shelf);
      return json(piece, 201);
    }

    if (request.method === "DELETE" && match) {
      shelf.pieces = shelf.pieces.filter((piece) => piece.id !== match[1]);
      await this.state.storage.put(STATE_KEY, shelf);
      return json({ deleted: true });
    }

    if (request.method === "DELETE" && url.pathname === "/internal/shelf") {
      await this.state.storage.deleteAll();
      return json({ deleted: true });
    }

    return json({ error: "Route not found" }, 404);
  }
}
