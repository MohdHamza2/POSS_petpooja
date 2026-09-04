import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('Real API Gateway Routes', () => {
  const app = createApp();

  it('GET /healthz returns 200 ok', async () => {
    const res = await request(app).get('/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('POST /auth/login returns 400 or 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'unknown@example.com', password: 'wrong' });
    expect([400, 401]).toContain(res.status);
  });

  it('GET /menu/items returns 401 when unauthorized', async () => {
    await request(app).get('/menu/items').expect(401);
  });

  it('GET /kitchen/stations returns 401 when unauthorized', async () => {
    await request(app).get('/kitchen/stations').expect(401);
  });

  it('GET /health returns 200 ok with db status', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.db).toEqual('UP');
    expect(res.body.status).toEqual('OK');
  });

  it('POST /auth/logout returns 401 when unauthorized (no token)', async () => {
    await request(app).post('/auth/logout').expect(401);
  });
});
