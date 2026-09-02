import http from 'http';
import { createApp } from './app';
import { setupWebSockets } from './websockets';
import { prisma } from './prisma';
import { startOutboxProcessor } from './orchestration/outbox-processor';
import { ensureMonthlyPartitions } from './ensure-monthly-partitions';

const app = createApp();

const server = http.createServer(app);
setupWebSockets(server);

// Real API Gateway port per brain/SYSTEM_ARCHITECTURE.md and .env (API_PORT).
// NOTE: PORT in .env (4444) belongs to apps/pos-web, not this service — do
// not fall back to it here.
const port = Number(process.env.API_PORT ?? 4001);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(`Kapmeta API port ${port} already in use. Existing process is healthy. Start POS only: npm run dev -w @kapmeta/pos-web`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  startOutboxProcessor(prisma);
  void ensureMonthlyPartitions(prisma);
  // eslint-disable-next-line no-console
  console.log(`Kapmeta API listening on port ${port}`);
});
