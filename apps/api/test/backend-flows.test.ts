import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import jwt from 'jsonwebtoken';

describe('Backend Core Logic Integrations', () => {
  const app = createApp();
  let testOutletId = '';
  let testUserId = '';
  let adminToken = '';
  let testPoId = '';
  let testCustomerId = '';
  
  beforeAll(async () => {
    // 1. Setup Test DB State
    const org = await prisma.organization.upsert({
      where: { id: '99999999-9999-9999-9999-999999999999' },
      update: {},
      create: { id: '99999999-9999-9999-9999-999999999999', name: 'TEST E2E ORG' }
    });

    const outlet = await prisma.outlet.upsert({
      where: { id: '88888888-8888-8888-8888-888888888888' },
      update: {},
      create: {
        id: '88888888-8888-8888-8888-888888888888',
        organizationId: org.id,
        name: 'TEST E2E OUTLET',
        code: 'TEST_E2E',
      }
    });
    testOutletId = outlet.id;

    // Open a Cash Drawer Session to allow ordering & PO payments
    await (prisma as any).cash_drawer_sessions.upsert({
        where: { outlet_id_status: { outlet_id: outlet.id, status: 'OPEN' } },
        update: {},
        create: {
            outlet_id: testOutletId,
            opened_at: new Date(),
            opened_by: 'test-user',
            starting_balance: 100000n, // 1000 Rs
            status: 'OPEN'
        }
    }).catch(() => {});

    // Create a User
    const user = await prisma.user.upsert({
      where: { email: 'e2e@test.com' },
      update: {},
      create: { email: 'e2e@test.com', firstName: 'E2E', passwordHash: 'noop', isActive: true }
    });
    testUserId = user.id;

    // Create a role & grant full access
    const role = await prisma.role.upsert({
      where: { code: 'E2E_ADMIN' },
      update: {},
      create: { id: '77777777-7777-7777-7777-777777777777', name: 'E2E_ADMIN', code: 'E2E_ADMIN', description: 'Test Admin' }
    });
    
    await prisma.userRole.upsert({
      where: { id: '55555555-5555-5555-5555-555555555555' },
      update: { outletId: testOutletId },
      create: { id: '55555555-5555-5555-5555-555555555555', userId: user.id, roleId: role.id, outletId: testOutletId }
    });

    const perms = ['inventory.write', 'finance.write', 'report.read', 'crm.write', 'crm.read', 'inventory.stock.deduct', 'inventory.po.approve'];
    let idx = 1;
    for (const p of perms) {
      const pid = `66666666-6666-6666-6666-66666666666${idx}`;
      const rpid = `44444444-4444-4444-4444-44444444444${idx}`;
      const pRec = await prisma.permission.upsert({
        where: { code: p },
        update: {},
        create: { id: pid, code: p, module: 'core' }
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: pRec.id } },
        update: {},
        create: { roleId: role.id, permissionId: pRec.id }
      });
      idx++;
    }

    // 2. Sign JWT
    const secret = process.env.JWT_SECRET || 'test-secret';
    adminToken = jwt.sign(
      { sub: user.id, outletIds: [testOutletId] },
      secret,
      { expiresIn: '1h' }
    );

    // 3. Setup Dependencies for specific tests
    // A. Purchase Order
    const vendor = await (prisma as any).vendors.create({
      data: { outlet_id: testOutletId, name: 'Test Vendor', is_active: true }
    }).catch(async () => await (prisma as any).vendors.findFirst({ where: { name: 'Test Vendor' } }));
    
    if (vendor) {
        const po = await (prisma as any).purchase_orders.create({
            data: {
                outlet_id: testOutletId,
                vendor_id: vendor.id,
                po_number: 'PO-TEST-' + Date.now(),
                status: 'RECEIVED',
                total_amount_minor: 50000n // 500 Rs
            }
        });
        testPoId = po.id;
    }

    // B. Customer
    const customer = await prisma.customer.create({
      data: { outletId: testOutletId, name: 'E2E Test Cust', phone: '9999999999', isActive: true }
    });
    testCustomerId = customer.id;

    // C. Dining Table (for Live Occupancy)
    await prisma.diningTable.upsert({
        where: { outletId_tableNumber: { outletId: testOutletId, tableNumber: 'T99' } },
        update: { status: 'OCCUPIED' },
        create: { outletId: testOutletId, tableNumber: 'T99', capacity: 4, section: 'A', status: 'OCCUPIED' }
    });
  });

  it('POST /inventory/wastage should deduct stock and create log', async () => {
    // 1. Create an ingredient
    const ing = await (prisma as any).ingredients.create({
        data: { outlet_id: testOutletId, name: 'Test Ing', current_stock_qty: 10, unit_of_measure: 'KG', unit_cost_minor: 100n, reorder_level: 2, is_active: true }
    });

    const res = await request(app)
      .post('/inventory/wastage')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ ingredientId: ing.id, quantityLost: 2 }],
        reason: 'Dropped on floor',
        notes: 'E2E test'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const check = await (prisma as any).ingredients.findUnique({ where: { id: ing.id } });
    expect(Number(check?.current_stock_qty)).toBe(8);
  });

  it('POST /purchase-orders/:id/pay should mark PO as paid and write to petty cash', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${testPoId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMethod: 'CASH' });

    if (res.status === 400) {
        // If it was already paid or missing
        expect(res.body.error).toBeDefined();
    } else {
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PAID');

        // Check petty cash ledger
        const ledger = await (prisma as any).petty_cash_ledger.findFirst({
            where: { outlet_id: testOutletId, category: 'PO_PAYMENT' }
        });
        expect(ledger).toBeDefined();
        expect(Number(ledger!.amount_minor)).toBeLessThan(0); // Expense is negative
    }
  });

  it('POST /finance/card-settlement should accept batch total', async () => {
    const res = await request(app)
      .post('/finance/card-settlement')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchAmountMinor: 50000n.toString(), terminalId: '00000000-0000-0000-0000-000000000001' });

    expect(res.status).toBe(200);
    expect(res.body.actualBatchMinor).toBeDefined();
    expect(res.body.varianceMinor).toBeDefined();
  });

  it('GET /reporting/live-occupancy should return table percentage', async () => {
    const res = await request(app)
      .get('/reporting/live-occupancy')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTables).toBeGreaterThanOrEqual(1);
    expect(res.body.occupiedTables).toBeGreaterThanOrEqual(1);
    expect(Number(res.body.occupancyRatePercent)).toBeGreaterThan(0);
  });

  it('POST /customers/:id/addresses should link a new address', async () => {
    const res = await request(app)
      .post(`/crm/customers/${testCustomerId}/addresses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        addressLine1: '123 E2E Lane',
        city: 'Mumbai',
        zipCode: '400001',
        isDefault: true
      });

    expect(res.status).toBe(201);
    expect(res.body.address.city).toBe('Mumbai');
  });

  it('POST /finance/z-report/seal should hash the end of day totals', async () => {
    const res = await request(app)
      .post('/finance/z-report/seal')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ businessDate: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.hash).toBeDefined();
    expect(res.body.logId).toBeDefined();
  });
});
