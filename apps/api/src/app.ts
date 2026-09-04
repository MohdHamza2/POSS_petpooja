import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';

// Real, Prisma-backed routers (self-contained — each owns its own
// PrismaClient and requireAuth/requirePermission wiring; no Container
// dependency). These are the actual service surface documented in
// brain/API_AND_EVENTS_CATALOG.md and brain/WIRING_GUIDE.md.
import { authRouter } from './routes/auth';
import { menuRouter } from './routes/menu';
import { kitchenRouter } from './routes/kitchen';
import { financeRouter } from './routes/finance';
import { crmRouter } from './routes/crm';
import { integrationRouter } from './routes/integration';
import { inventoryRouter } from './routes/inventory';
import { marketingRouter } from './routes/marketing';
import { notificationsRouter } from './routes/notifications';
import { publicOrderRouter } from './routes/public-order';
import { purchaseRouter } from './routes/purchase';
import { reportingRouter } from './routes/reporting';
import { userManagementRouter } from './routes/user-management';
import { waitersRouter } from './routes/waiters';
import { tablesRouter } from './routes/tables';
import { ordersRouter } from './routes/orders';
import { settingsRouter } from './routes/settings';
import { healthRouter } from './routes/health';

// Global BigInt JSON serialization support for Express
// Uses String to prevent precision loss for amounts > 2^53
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export function createApp(): Express {
  const app = express();
  app.use(cors({
    origin: [process.env.POS_WEB_URL || 'http://localhost:4444', 'http://localhost:4445'],
    credentials: true,
  }));
  app.use(express.json());

  // --- Real service routers (top-level prefixes per API_AND_EVENTS_CATALOG.md) ---
  app.use(healthRouter);
  app.use('/auth', authRouter);
  app.use('/menu', menuRouter);
  app.use('/kitchen', kitchenRouter);
  app.use('/finance', financeRouter);
  app.use('/crm', crmRouter);
  app.use('/inventory', inventoryRouter);
  app.use('/marketing', marketingRouter);
  app.use('/reporting', reportingRouter);

  // These routers already define fully-qualified paths internally
  // (e.g. /integrations/..., /notifications, /public/..., /purchase-orders,
  // /users, /waiters/...), so they're mounted at root rather than under an
  // extra prefix.
  app.use(integrationRouter);
  app.use(notificationsRouter);
  app.use(publicOrderRouter);
  app.use(purchaseRouter);
  app.use(userManagementRouter);
  app.use(waitersRouter);
  app.use(tablesRouter);
  app.use(ordersRouter);
  app.use(settingsRouter);

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: 'InternalServerError', message });
  });

  return app;
}
