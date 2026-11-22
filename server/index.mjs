import http from 'node:http';
import { prisma } from './db.mjs';
import { authenticateRequest } from './auth.mjs';
import { handleApiRoute } from './routes.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  try {
    const me = await authenticateRequest(req);
    const result = await handleApiRoute(req, url, me);
    if (!result) {
      sendJson(res, 404, { message: `Not found: ${req.method} ${url.pathname}` });
      return;
    }
    sendJson(res, result.status, result.data);
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) {
      console.error(`[server] ${req.method} ${url.pathname} error:`, err);
    }
    sendJson(res, status, { message: err instanceof Error ? err.message : 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] Chat API listening on http://localhost:${PORT} (Neon PostgreSQL + Prisma)`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
