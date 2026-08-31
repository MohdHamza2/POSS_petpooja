import { PrismaClient } from "@prisma/client";

export interface OrderSettledEvent {
  invoiceId: string;
  orderId: string;
  outletId: string;
}

export interface JournalLine {
  account: string;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface LedgerEntryListFilter {
  fromDate?: Date;
  toDate?: Date;
  account?: string;
}

export interface LedgerEntryListItem {
  id: string;
  sourceType: string;
  sourceId: string;
  account: string;
  debitMinor: bigint;
  creditMinor: bigint;
  externalRef: string | null;
  status: string;
  createdAt: Date;
  postedAt: Date | null;
}

export interface LedgerRepository {
  listLedgerEntries(outletId: string, filter: LedgerEntryListFilter): Promise<LedgerEntryListItem[]>;
}

export async function listLedgerEntries(
  outletId: string,
  filter: LedgerEntryListFilter,
  repo: LedgerRepository,
): Promise<LedgerEntryListItem[]> {
  if (filter.fromDate && filter.toDate && filter.fromDate > filter.toDate) {
    throw new Error("fromDate must be before or equal to toDate");
  }
  return repo.listLedgerEntries(outletId, filter);
}

export class LedgerEngine {
  constructor(private readonly prisma: PrismaClient) {}

  start(subscriber?: (handler: (event: OrderSettledEvent) => void) => void) {
    if (subscriber) {
      subscriber(this.handleOrderSettled.bind(this));
    }
    console.log("[LedgerEngine] Autonomous Double-Entry posting listener active");
  }

  async handleOrderSettled(event: OrderSettledEvent) {
    try {
      const invoice = await (this.prisma as any).invoice?.findFirst?.({
        where: { orderId: event.orderId, outletId: event.outletId },
      });
      if (invoice) {
        await this.postInvoiceJournal(event.outletId, invoice.id);
      }
    } catch (err) {
      console.error(`[LedgerEngine] Error posting journal for order ${event.orderId}:`, err);
    }
  }

  /**
   * Posts a balanced double-entry journal voucher for a settled tax invoice.
   * Invariant: SUM(Debit) === SUM(Credit)
   */
  async postInvoiceJournal(outletId: string, invoiceId: string): Promise<{ voucherId: string; lines: number }> {
    const invoice = await (this.prisma as any).invoice?.findUnique?.({
      where: { id: invoiceId, outletId },
      include: {
        order: {
          include: {
            payments: true,
            orderDiscounts: true,
          },
        },
      },
    });

    if (!invoice) {
      return { voucherId: "NONE", lines: 0 };
    }

    const lines: JournalLine[] = [];

    // 1. Calculate discount allowances (Expense / Contra-Revenue)
    let discountSum = 0n;
    for (const d of (invoice.order?.orderDiscounts || [])) {
      lines.push({
        account: "5010-DISCOUNTS",
        debitMinor: d.amount,
        creditMinor: 0n,
      });
      discountSum += d.amount;
    }

    // 2. Credit Gross Sales Revenue (F&B)
    const grossSales = BigInt(invoice.amount || 0) - BigInt(invoice.taxAmount || 0) + discountSum;
    if (grossSales > 0n) {
      lines.push({
        account: "4010-SALES-FNB",
        debitMinor: 0n,
        creditMinor: grossSales,
      });
    }

    // 3. Credit Output GST Liability
    if (invoice.taxAmount && BigInt(invoice.taxAmount) > 0n) {
      lines.push({
        account: "2010-OUTPUT-GST-5",
        debitMinor: 0n,
        creditMinor: BigInt(invoice.taxAmount),
      });
    }

    // 3. Debit Payments Received (Asset accounts)
    let paymentSum = 0n;
    for (const p of (invoice.order?.payments || [])) {
      const isBank = p.method === "CARD" || p.method === "UPI";
      const accountCode = isBank ? "1020-BANK-HDFC" : "1010-CASH";
      lines.push({
        account: accountCode,
        debitMinor: p.amount,
        creditMinor: 0n,
      });
      paymentSum += p.amount;
    }

    // Invariant Check: Verify Balanced Ledger Voucher
    const totalDebit = lines.reduce((acc, l) => acc + l.debitMinor, 0n);
    const totalCredit = lines.reduce((acc, l) => acc + l.creditMinor, 0n);

    if (totalDebit !== totalCredit) {
      throw new Error("DOUBLE_ENTRY_IMBALANCE");
    }

    // Atomic persistence of all balanced ledger entries
    const voucherRef = `JV-INV-${invoice.invoiceNo}`;
    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await (tx as any).ledgerEntry?.create?.({
          data: {
            outletId,
            sourceType: "ORDER",
            sourceId: invoice.orderId,
            account: line.account,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            externalRef: voucherRef,
            status: "POSTED",
            postedAt: new Date(),
          },
        });
      }
    });

    return { voucherId: voucherRef, lines: lines.length };
  }

  /**
   * Posts a balanced double-entry reversal journal voucher for a refund.
   * Invariant: SUM(Debit) === SUM(Credit)
   */
  async postRefundJournal(outletId: string, refundId: string): Promise<{ voucherId: string; lines: number }> {
    const refund = await (this.prisma as any).refund?.findUnique?.({
      where: { id: refundId, outletId },
      include: {
        payment: true,
      },
    });

    if (!refund) {
      return { voucherId: "NONE", lines: 0 };
    }

    const lines: JournalLine[] = [];
    const isBank = refund.payment?.method === "CARD" || refund.payment?.method === "UPI";
    const paymentAccount = isBank ? "1020-BANK-HDFC" : "1010-CASH";

    // 1. Credit Cash/Bank (Asset deduction)
    lines.push({
      account: paymentAccount,
      debitMinor: 0n,
      creditMinor: refund.amount,
    });

    // 2. Debit Sales Contra (Revenue reduction)
    lines.push({
      account: "4010-SALES-FNB",
      debitMinor: refund.amount,
      creditMinor: 0n,
    });

    const totalDebit = lines.reduce((acc, l) => acc + l.debitMinor, 0n);
    const totalCredit = lines.reduce((acc, l) => acc + l.creditMinor, 0n);

    if (totalDebit !== totalCredit) {
      throw new Error("DOUBLE_ENTRY_IMBALANCE");
    }

    const voucherRef = `JV-REF-${refund.id.slice(0, 8).toUpperCase()}`;
    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await (tx as any).ledgerEntry?.create?.({
          data: {
            outletId,
            sourceType: "REFUND",
            sourceId: refund.id,
            account: line.account,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            externalRef: voucherRef,
            status: "POSTED",
            postedAt: new Date(),
          },
        });
      }
    });

    return { voucherId: voucherRef, lines: lines.length };
  }
}
