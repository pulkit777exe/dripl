import type { IncomingMessage, ServerResponse } from 'http';

function jsonResponse(res: ServerResponse, data: Record<string, unknown>): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function healthHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === '/health') {
    jsonResponse(res, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'ws-server',
    });
  } else if (req.url === '/metrics') {
    jsonResponse(res, {
      uptime: process.uptime(),
      memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}
