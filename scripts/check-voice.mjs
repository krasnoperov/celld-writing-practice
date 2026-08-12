// Fails the build when machine language reaches a writer-facing surface.
// The rules live in docs/VOICE.md; the admin page is exempt (operator tool).
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const failures = [];

function stringLiterals(source) {
  return [...source.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gs)].map((match) => match[0]);
}

function htmlCopy(source) {
  const markup = source
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  const text = [...markup.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
  const attributes = [...markup.matchAll(/(?:placeholder|content|aria-label|alt|title)="([^"{]*)"/g)].map((match) => match[1]);
  return [...text, ...attributes];
}

function scan(file, pieces, patterns) {
  for (const piece of pieces) {
    for (const pattern of patterns) {
      const match = piece.match(pattern);
      if (match) failures.push(`${file}: "${match[0]}" in ${JSON.stringify(piece.trim().slice(0, 80))}`);
    }
  }
}

// "revision" as the act of revising is coach language; "revision 7" is the
// machine filing itself, so only the numbered form is banned.
const CHROME_BANS = [
  /\bcelld?s?\b/i,
  /\bagents?\b/i,
  /\blearners?\b/i,
  /\brevisions?\s+\d/i,
  /\bappend.only\b/i,
  /\bdurable\b/i,
  /\bopenai\b/i,
];

const COACH_BANS = [
  /\blearners?\b/i,
  /\bstudents?\b/i,
  /\bexercises?\b/i,
  /\bassignments?\b/i,
  /\bhomework\b/i,
  /\bagents?\b/i,
  /\bcelld?s?\b/i,
  /\bopenai\b/i,
];

const frontendSrc = new URL("frontend/src/", root);
scan("frontend/src/lib/copy.js", stringLiterals(await readFile(new URL("lib/copy.js", frontendSrc), "utf8")), CHROME_BANS);
// admin is an operator tool, video is the technical explainer film page, and
// the privacy page must name real processors — all speak machine language on
// purpose.
for (const entry of await readdir(frontendSrc, { recursive: true })) {
  if (!entry.endsWith(".svelte") || entry.startsWith("admin") || entry.startsWith("video")) continue;
  if (entry === "site/Privacy.svelte") continue;
  scan(`frontend/src/${entry}`, htmlCopy(await readFile(new URL(entry, frontendSrc), "utf8")), CHROME_BANS);
}
scan("src/providers/demo.js", stringLiterals(await readFile(new URL("src/providers/demo.js", root), "utf8")), COACH_BANS);
scan("src/piece-core.js", stringLiterals(await readFile(new URL("src/piece-core.js", root), "utf8")), [
  /\blearners?\b/i,
  /\bagents?\b/i,
  /\bcelld?s?\b/i,
  /\bexercises?\b/i,
]);

if (failures.length) {
  console.error("Voice contract failed — machine language on a writer-facing surface:");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Voice contract passed: no machine language on writer-facing surfaces.");
}
