"use strict";
// Mirrors the writeAuditLog pattern in packages/shared-types/audit-log.ts:
// a small, DB-shape-agnostic writer function plus a repository interface,
// meant to be called inside the same transaction as the business mutation
// (and usually right alongside a writeAuditLog call) it is notifying about.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.writeNotification = writeNotification;
/**
 * Creates one notification row. Call inside the same transaction as the
 * business-event mutation that triggered it (PO approval/cancellation,
 * an unusual stock adjustment, a refund) — same convention as
 * writeAuditLog, so the notification and the audit trail commit atomically.
 */
async function createNotification(input, repo) {
    if (!input.title || input.title.trim().length === 0) {
        throw new Error("title is mandatory for a notification");
    }
    if (!input.message || input.message.trim().length === 0) {
        throw new Error("message is mandatory for a notification");
    }
    return repo.create(input);
}
/**
 * Low-level write for call sites that already hold an open transaction (e.g.
 * alongside writeAuditLog inside PrismaInventoryRepository.postManualAdjustment,
 * PrismaFinanceRepository.createRefund, PrismaPurchaseRepository.recordPoTransition).
 * Does not go through the createNotification() validation above — call sites
 * that build their own title/message strings are trusted to pass non-empty ones.
 */
async function writeNotification(client, input) {
    await client.notification.create({
        data: {
            outletId: input.outletId,
            userId: input.userId ?? undefined,
            type: input.type,
            title: input.title,
            message: input.message,
            entityType: input.entityType ?? undefined,
            entityId: input.entityId ?? undefined,
        },
    });
}
