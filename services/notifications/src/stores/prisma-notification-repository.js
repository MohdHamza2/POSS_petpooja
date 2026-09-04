"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaNotificationRepository = void 0;
class PrismaNotificationRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(input) {
        const row = await this.prisma.notification.create({
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
        return row;
    }
    // Scoped to userId first (per-user notifications) OR userId null (outlet-wide
    // broadcasts) within the same outlet — matches the schema's "null = broadcast"
    // convention. Unread first, newest first within each bucket.
    async listForUser(outletId, userId) {
        const rows = await this.prisma.notification.findMany({
            where: {
                outletId,
                OR: [{ userId }, { userId: null }],
            },
            orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
        });
        return rows;
    }
    async markRead(id, userId) {
        const existing = await this.prisma.notification.findUnique({ where: { id } });
        if (!existing)
            return null;
        // A broadcast (userId null) can be marked read by any user it was scoped
        // to via outletId; a personal notification can only be marked read by its owner.
        if (existing.userId !== null && existing.userId !== userId)
            return null;
        const row = await this.prisma.notification.update({
            where: { id },
            data: { isRead: true },
        });
        return row;
    }
    async markAllRead(outletId, userId) {
        const result = await this.prisma.notification.updateMany({
            where: {
                outletId,
                OR: [{ userId }, { userId: null }],
                isRead: false,
            },
            data: { isRead: true },
        });
        return result.count;
    }
}
exports.PrismaNotificationRepository = PrismaNotificationRepository;
