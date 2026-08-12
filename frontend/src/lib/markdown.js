export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function inlineMarkdown(value) {
  const parts = [];
  let cursor = 0;
  const links = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of value.matchAll(links)) {
    parts.push(escapeHtml(value.slice(cursor, match.index)));
    parts.push(`<a href="${escapeHtml(match[2])}" target="_blank" rel="noreferrer">${escapeHtml(match[1])}</a>`);
    cursor = match.index + match[0].length;
  }
  parts.push(escapeHtml(value.slice(cursor)));
  return parts.join("").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderMarkdown(markdown) {
  const output = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { output.push("</ul>"); listOpen = false; } };
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!listOpen) { output.push("<ul>"); listOpen = true; }
      output.push(`<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) { output.push("<hr>"); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { const level = Math.min(heading[1].length + 1, 5); output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
    if (/^>\s?/.test(line)) { output.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("");
}
