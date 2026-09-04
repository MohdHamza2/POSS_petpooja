import type { PrismaClient } from "@prisma/client";

/**
 * Pre-create monthly partitions for audit/access/config so payment and settle
 * audit writes do not fail at month rollover (SQLSTATE 23514).
 */
export async function ensureMonthlyPartitions(prisma: PrismaClient): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      "SELECT ensure_monthly_partitions(18) AS n"
    );
    const n = rows[0]?.n ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[api] monthly partitions ensured (${n})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[api] monthly partition ensure skipped: ${message}`);
  }
}
