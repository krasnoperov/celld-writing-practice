import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// Static pages are authored in Svelte but rendered to HTML at build time and
// shipped without JavaScript. The client mounts exist only for the dev server.
const PRERENDERED = {
  "privacy.page": { html: "privacy.html", component: "/src/site/Privacy.svelte" },
  "pricing.page": { html: "pricing.html", component: "/src/site/Pricing.svelte" },
};

async function prerenderPages() {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: here("."),
    logLevel: "error",
    plugins: [svelte()],
    appType: "custom",
    server: { middlewareMode: true },
  });
  try {
    const { render } = await server.ssrLoadModule("svelte/server");
    for (const [page, { html, component }] of Object.entries(PRERENDERED)) {
      const { default: Component } = await server.ssrLoadModule(component);
      const document = (await readFile(here(`../dist/${html}`), "utf8"))
        .replace(/\s*<script type="module"[^>]*><\/script>/, "")
        .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
        .replace('<div id="app"></div>', `<div id="app">${render(Component).body}</div>`);
      await writeFile(here(`../dist/${page}`), document);
      await rm(here(`../dist/${html}`));
    }
  } finally {
    await server.close();
  }
}

// celld's asset layer implements Cloudflare html_handling: `.html` paths
// 307-redirect, so pages routed by the worker ship as `.page` files.
function celldPages() {
  return {
    name: "celld-pages",
    apply: "build",
    async closeBundle() {
      await rename(here("../dist/admin.html"), here("../dist/admin.page"));
      await prerenderPages();
    },
  };
}

export default defineConfig({
  plugins: [svelte(), celldPages()],
  appType: "mpa",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: here("index.html"),
        admin: here("admin.html"),
        privacy: here("privacy.html"),
        pricing: here("pricing.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8931",
      "/auth": "http://127.0.0.1:8931",
    },
  },
});
