import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number.parseInt(process.env.PORT ?? '3000', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const resolvePath = (requestUrl) => {
  const requestPath = requestUrl === '/' ? '/index.html' : requestUrl;
  const safePath = path
    .normalize(requestPath)
    .replace(/^[/\\]+/, '')
    .replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(__dirname, safePath);
};

const writeJsonToRepo = async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(rawBody);
  const content = `${JSON.stringify(parsed, null, 2)}\n`;
  const targetPath = path.join(__dirname, 'data.json');
  await writeFile(targetPath, content, 'utf8');

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true }));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/__save_data') {
      await writeJsonToRepo(req, res);
      return;
    }

    const filePath = resolvePath(url.pathname);
    const fileStats = await stat(filePath);

    if (fileStats.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    const statusCode = error?.code === 'ENOENT' ? 404 : 500;
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(statusCode === 404 ? 'Not Found' : 'Server Error');
  }
});

server.listen(port, () => {
  console.log(`CRUD server running at http://localhost:${port}`);
});
