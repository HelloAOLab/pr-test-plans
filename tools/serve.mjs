#!/usr/bin/env node
// Local preview server: `npm run preview`, then open http://localhost:8080/.
//
// Serves the repo as GitHub Pages would, with caching off so edits show on
// reload. The plan list and each PR's revisions.json are rebuilt whenever the
// page asks for them, so a new or edited plan file only needs a reload.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function rebuildIndex() {
  const res = spawnSync(
    process.execPath,
    [join(root, "tools", "plan.mjs"), "index", join(root, "plans"), join(root, "plans", "index.json")],
    { encoding: "utf8" }
  );
  // Surface the deploy's ::warning lines so plan problems show up here too.
  for (const line of `${res.stdout}${res.stderr}`.split("\n")) {
    // Lazy match: Windows paths contain a ":" after the drive letter.
    if (line.startsWith("::warning")) console.warn(line.replace(/^::warning file=(.*?)::/, "⚠ $1: "));
  }
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = normalize(urlPath).replace(/^[/\\]+/, "");
  // Refuse anything that would resolve outside the repo, and dot-folders like .git.
  if (rel.split(sep).some((part) => part === ".." || part.startsWith("."))) {
    send(res, 404, "Not found");
    return;
  }
  if (/^plans[/\\](index\.json|.+[/\\]revisions\.json)$/.test(rel)) rebuildIndex();

  let file = join(root, rel);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
});

rebuildIndex();
server.listen(port, () => {
  console.log(`Previewing at http://localhost:${port}/`);
  console.log(`With example plans: http://localhost:${port}/?dev=true`);
  console.log("Press Ctrl+C to stop.");
});
