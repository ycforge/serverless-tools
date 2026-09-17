import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8080);

const server = createServer((req, res) => {
  const path = req.url ?? '/';
  if (path === '/api/analytics' || path === '/analytics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: 'e2e-container', path, ok: true }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'e2e-container', path, ok: false }));
});

server.listen(port, () => {
  console.log(JSON.stringify({ e2eMarker: 'E2E_CONTAINER_STARTED', port }));
});
