// Мини-сервер для веб-версии: npm run web, затем открыть http://localhost:3000
// Нужен потому, что браузер не загружает JS-модули (import) с file:// —
// страницу надо открывать через http. Внешние библиотеки не используются.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url)); // папка проекта
const PORT = Number(process.env.PORT) || 3000;

// Тип содержимого по расширению файла: без него браузер не выполнит модуль.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const filePath = normalize(join(ROOT, urlPath === "/" ? "index.html" : urlPath));
  // Защита: не отдаём файлы за пределами папки проекта ("/../../secret").
  if (!filePath.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": TYPES[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`Откройте http://localhost:${PORT}`));
