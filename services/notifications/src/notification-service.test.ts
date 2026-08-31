import { describe, it, expect } from "vitest";
import { createNotification, type NotificationRepository, type NotificationRecord } from "./notification-service";

function makeRepo(overrides: Partial<NotificationRepository> = {}): NotificationRepository & { createCallCount: number } {
  const repo = {
    createCallCount: 0,
    async create(input: Parameters<NotificationRepository["create"]>[0]): Promise<NotificationRecord> {
      repo.createCallCount++;
      return {
        id: "notif-1",
        outletId: input.outletId,
        userId: input.userId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        isRead: false,
        createdAt: new Date("2026-08-09T00:00:00Z"),
      };
    },
    async listForUser(): Promise<NotificationRecord[]> {
      return [];
    },
    async markRead(): Promise<NotificationRecord | null> {
      return null;
    },
    async markAllRead(): Promise<number> {
      return 0;
    },
    ...overrides,
  };
  return repo;
}

describe("createNotification", () => {
  it("creates a notification with the given fields", async () => {
    const repo = makeRepo();
    const result = await createNotification(
      {
        outletId: "outlet-1",
        userId: "user-1",
        type: "PO_APPROVED",
        title: "PO approved",
        message: "Purchase order PO-2026-0001 was approved",
        entityType: "PURCHASE_ORDER",
        entityId: "po-1",
      },
      repo,
    );

    expect(repo.createCallCount).toBe(1);
    expect(result).toEqual(
      expect.objectContaining({
        outletId: "outlet-1",
        userId: "user-1",
        type: "PO_APPROVED",
        title: "PO approved",
        isRead: false,
      }),
    );
  });

  it("supports a broadcast notification with no userId", async () => {
    const repo = makeRepo();
    const result = await createNotification(
      {
        outletId: "outlet-1",
        type: "STOCK_ADJUSTMENT_UNUSUAL",
        title: "Unusual stock adjustment",
        message: "Large adjustment recorded",
      },
      repo,
    );
    expect(result.userId).toBeNull();
  });

  it("rejects an empty title without calling the repository", async () => {
    const repo = makeRepo();
    await expect(
      createNotification({ outletId: "outlet-1", type: "REFUND_ISSUED", title: "", message: "x" }, repo),
    ).rejects.toThrow("title is mandatory");
    expect(repo.createCallCount).toBe(0);
  });

  it("rejects an empty message without calling the repository", async () => {
    const repo = makeRepo();
    await expect(
      createNotification({ outletId: "outlet-1", type: "REFUND_ISSUED", title: "x", message: "   " }, repo),
    ).rejects.toThrow("message is mandatory");
    expect(repo.createCallCount).toBe(0);
  });
});
