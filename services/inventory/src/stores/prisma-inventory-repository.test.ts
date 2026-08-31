import { describe, it, expect } from "vitest";
import { PrismaInventoryRepository } from "./prisma-inventory-repository";
import type { ManualAdjustmentInput } from "@kapmeta/shared-types/inventory";

// Minimal fake mimicking the subset of PrismaClient/tx surface
// postManualAdjustment touches: $transaction, ingredient.findUnique/update,
// stockMovement.create, auditLog.create, notification.create.
function makeFakePrisma() {
  const calls: { auditLog: unknown[]; notification: unknown[]; stockMovement: unknown[] } = {
    auditLog: [],
    notification: [],
    stockMovement: [],
  };

  const tx = {
    ingredients: {
      findUnique: async () => ({ current_stock_qty: 100, currentStock: { toNumber: () => 100 } }),
      update: async () => ({ current_stock_qty: 60, currentStock: { toNumber: () => 60 } }),
    },
    ingredient: {
      findUnique: async () => ({ currentStock: { toNumber: () => 100 } }),
      update: async () => ({ currentStock: { toNumber: () => 60 } }),
    },
    stockMovement: {
      create: async (args: unknown) => {
        calls.stockMovement.push(args);
      },
    },
    auditLog: {
      create: async (args: unknown) => {
        calls.auditLog.push(args);
      },
    },
    notification: {
      create: async (args: unknown) => {
        calls.notification.push(args);
      },
    },
  };

  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(tx),
  };

  return { prisma, calls };
}

describe("PrismaInventoryRepository.postManualAdjustment", () => {
  it("writes a STOCK_ADJUSTMENT_UNUSUAL notification for a large-magnitude adjustment, atomically with the audit log", async () => {
    const { prisma, calls } = makeFakePrisma();
    const repo = new PrismaInventoryRepository(prisma as never);

    const input: ManualAdjustmentInput = {
      outletId: "outlet-1",
      ingredientId: "flour",
      movementType: "WASTAGE",
      quantity: -75,
      reasonCode: "SPOILAGE",
    };

    await repo.postManualAdjustment(input, "user-test");

    expect(calls.auditLog).toHaveLength(1);
    expect(calls.notification).toHaveLength(1);
    const notificationArgs = calls.notification[0] as { data: Record<string, unknown> };
    expect(notificationArgs.data).toEqual(
      expect.objectContaining({
        outletId: "outlet-1",
        type: "STOCK_ADJUSTMENT_UNUSUAL",
        entityType: "STOCK",
        entityId: "flour",
      }),
    );
  });

  it("does not write a notification for a small, routine adjustment", async () => {
    const { prisma, calls } = makeFakePrisma();
    const repo = new PrismaInventoryRepository(prisma as never);

    const input: ManualAdjustmentInput = {
      outletId: "outlet-1",
      ingredientId: "flour",
      movementType: "ADJUSTMENT",
      quantity: 3,
      reasonCode: "COUNT_CORRECTION",
    };

    await repo.postManualAdjustment(input, "user-test");

    expect(calls.auditLog).toHaveLength(1);
    expect(calls.notification).toHaveLength(0);
  });
});
