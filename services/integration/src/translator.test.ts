import { describe, it, expect, vi } from 'vitest';
import { IntegrationTranslator } from './translator';
import { PrismaClient } from '@prisma/client';

describe('IntegrationTranslator', () => {
  it('translates a Swiggy order payload correctly', async () => {
    const mockPrisma = {
      channelAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'account-1',
          outletId: 'outlet-1',
        })
      },
      channelItemMapping: {
        findMany: vi.fn().mockResolvedValue([
          { externalItemId: 'ext-item-1', menuItemId: 'internal-1' },
          { externalItemId: 'ext-item-2', menuItemId: 'internal-2' },
        ])
      }
    } as unknown as PrismaClient;

    const translator = new IntegrationTranslator(mockPrisma);
    
    const payload = {
      order_id: 'swiggy-123',
      total_amount: 550.50,
      items: [
        { item_id: 'ext-item-1', quantity: 2, price: 200, notes: 'Spicy' },
        { item_id: 'ext-item-2', quantity: 1, price: 150.50 }
      ]
    };

    const result = await translator.translateSwiggyOrder('account-1', payload);

    expect(result.outletId).toBe('outlet-1');
    expect(result.externalOrderId).toBe('swiggy-123');
    expect(result.partnerStatedTotal).toBe(55050n);
    expect(result.computedTotal).toBe(55050n); // (200*2) + 150.50 = 550.50

    expect(result.orderInput.lines).toHaveLength(2);
    expect(result.orderInput.lines[0].menuItemId).toBe('internal-1');
    expect(result.orderInput.lines[0].subtotal).toBe(40000n);
    
    expect(result.kotInput.lines).toHaveLength(2);
    expect(result.kotInput.lines[0].notes).toBe('Spicy');
  });

  it('throws if mapping is missing', async () => {
    const mockPrisma = {
      channelAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'account-1',
          outletId: 'outlet-1',
        })
      },
      channelItemMapping: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as unknown as PrismaClient;

    const translator = new IntegrationTranslator(mockPrisma);
    
    const payload = {
      order_id: 'swiggy-123',
      total_amount: 200,
      items: [
        { item_id: 'ext-item-1', quantity: 1, price: 200 }
      ]
    };

    await expect(translator.translateSwiggyOrder('account-1', payload)).rejects.toThrow('Unmapped external item ID: ext-item-1');
  });
});
