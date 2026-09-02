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
    // #region agent log
    fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
      body: JSON.stringify({
        sessionId: "9c675b",
        hypothesisId: "P",
        location: "ensure-monthly-partitions.ts",
        message: "boot ensure_monthly_partitions",
        data: { n },
        timestamp: Date.now(),
        runId: "t05-settle",
      }),
    }).catch(err => console.error('Background task error:', err?.message || err));
    // #endregion
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[api] monthly partition ensure skipped: ${message}`);
  }
}
