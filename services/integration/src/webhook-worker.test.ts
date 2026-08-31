import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookWorker } from './webhook-worker';
import { PrismaClient } from '@prisma/client';
import { createOrder, transitionOrder } from '@kapmeta/orders';
import { emitOrderConfirmed } from '../../../apps/api/src/events';

vi.mock('@kapmeta/orders', () => ({
  createOrder: vi.fn(),
  transitionOrder: vi.fn(),
  PrismaMenuPriceLookup: vi.fn(),
  PrismaOrderRepository: vi.fn(),
}));

vi.mock('../../../apps/api/src/events', () => ({
  emitOrderConfirmed: vi.fn(),
}));

describe('WebhookWorker', () => {
  let mockPrisma: any;
  let worker: WebhookWorker;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      inboundEvent: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      channelAccount: {
        findUnique: vi.fn(),
      },
      channelItemMapping: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.channelAccountId_externalItemId?.externalItemId === "ext-item-1") {
            return { menuItemId: "internal-item-1", item_id: "internal-item-1", channelPrice: 20000n };
          }
          return null;
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      channelOrderMapping: {
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: vi.fn(),
      },
      integrationError: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    worker = new WebhookWorker(mockPrisma as unknown as PrismaClient, emitOrderConfirmed);
  });

  it('successfully processes a Swiggy ORDER_PLACED event', async () => {
    // Mock event
    mockPrisma.inboundEvent.findUnique.mockResolvedValue({
      id: 'event-123',
      channelAccountId: 'account-123',
      externalEventId: 'ext-event-123',
      eventType: 'ORDER_PLACED',
      status: 'RECEIVED',
      rawPayload: {
        order_id: 'swiggy-101',
        total_minor: 55000,
        items: [
          { item_id: 'ext-item-1', qty: 2, price_minor: 20000, notes: 'Spicy' }
        ]
      },
      receivedAt: new Date(),
    });

    // Mock channel account
    mockPrisma.channelAccount.findUnique.mockResolvedValue({
      id: 'account-123',
      channel: 'SWIGGY',
      status: 'ACTIVE',
      outletId: 'outlet-123',
      itemMappings: [
        { externalItemId: 'ext-item-1', menuItemId: 'internal-item-1' }
      ]
    });

    // Mock channel item mapping lookup
    mockPrisma.channelItemMapping.findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.channelAccountId_externalItemId?.externalItemId === "ext-item-1") {
        return { menuItemId: "internal-item-1", item_id: "internal-item-1", channelPrice: 20000n };
      }
      return null;
    });

    // Mock order creation and transition success
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-789',
      grandTotal: 40000n,
    });

    vi.mocked(createOrder).mockResolvedValue({
      id: 'order-789',
      status: 'PLACED',
      alreadyExisted: false,
    } as any);

    vi.mocked(transitionOrder).mockResolvedValue({
      ok: true,
      newStatus: 'CONFIRMED'
    } as any);

    await worker.processInboundEvent('event-123');

    // Should create order
    expect(createOrder).toHaveBeenCalled();
    expect(transitionOrder).toHaveBeenCalledWith('order-789', 'CONFIRMED', expect.any(Object), 'SYSTEM_INTEGRATION');
    
    // Should create channel mapping
    expect(mockPrisma.channelOrderMapping.create).toHaveBeenCalledWith({
      data: {
        channelAccountId: 'account-123',
        orderId: 'order-789',
        externalOrderId: 'swiggy-101',
        partnerStatedTotal: 55000n,
        computedTotal: 40000n,
      }
    });

    // Should record price mismatch (stated 550 vs computed 400)
    expect(mockPrisma.integrationError.create).toHaveBeenCalled();

    // Should update event status
    expect(mockPrisma.inboundEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-123' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date) }
    });

    // Should emit event
    expect(emitOrderConfirmed).toHaveBeenCalledWith({ orderId: 'order-789' });
  });

  it('successfully processes a Swiggy ORDER_CANCELLED event', async () => {
    mockPrisma.inboundEvent.findUnique.mockResolvedValue({
      id: 'event-123',
      channelAccountId: 'account-123',
      externalEventId: 'ext-event-123',
      eventType: 'ORDER_CANCELLED',
      status: 'RECEIVED',
      rawPayload: {
        order_id: 'swiggy-101'
      },
      receivedAt: new Date(),
    });

    mockPrisma.channelAccount.findUnique.mockResolvedValue({
      id: 'account-123',
      channel: 'SWIGGY',
      status: 'ACTIVE',
      outletId: 'outlet-123'
    });

    mockPrisma.channelOrderMapping.findFirst.mockResolvedValue({
      orderId: 'order-789',
      externalOrderId: 'swiggy-101',
    });

    vi.mocked(transitionOrder).mockResolvedValue({
      ok: true,
      newStatus: 'CANCELLED'
    } as any);

    await worker.processInboundEvent('event-123');

    expect(transitionOrder).toHaveBeenCalledWith('order-789', 'CANCELLED', expect.any(Object), 'SYSTEM_INTEGRATION', 'CUSTOMER_CANCELLED');
    expect(mockPrisma.inboundEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-123' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date) }
    });
  });

  it('quarantines the event if mapping fails', async () => {
    mockPrisma.inboundEvent.findUnique.mockResolvedValue({
      id: 'event-123',
      channelAccountId: 'account-123',
      externalEventId: 'ext-event-123',
      eventType: 'ORDER_PLACED',
      status: 'RECEIVED',
      rawPayload: {
        order_id: 'swiggy-101',
        total_minor: 55000,
        items: [
          { item_id: 'unmapped-item', qty: 2, price_minor: 20000 }
        ]
      },
      receivedAt: new Date(),
    });

    mockPrisma.channelAccount.findUnique.mockResolvedValue({
      id: 'account-123',
      channel: 'SWIGGY',
      status: 'ACTIVE',
      outletId: 'outlet-123',
      itemMappings: [] // No mappings
    });

    mockPrisma.channelItemMapping.findUnique.mockResolvedValue(null);

    await worker.processInboundEvent('event-123');

    // Should update event status to QUARANTINED
    expect(mockPrisma.inboundEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-123' },
      data: { status: 'QUARANTINED' }
    });

    // Should log translation failed error
    expect(mockPrisma.integrationError.create).toHaveBeenCalledWith({
      data: {
        source: 'WEBHOOK_WORKER',
        sourceId: 'ext-event-123',
        errorCode: 'TRANSLATION_FAILED',
        message: expect.stringContaining('Unmapped external item IDs found'),
      }
    });
  });
});
