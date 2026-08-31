import React, { useState, useEffect } from "react";
import Head from "next/head";
import { authedFetch, useAuthGuard } from "../lib/auth";
import Nav from "../components/Nav";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";

// Real response shape of GET /z-report (services/finance/src/z-report.ts
// ZReportGenerator.generateDailyReport, serialized by apps/api/src/routes/finance.ts
// with bigint fields converted to strings).
interface ZReportApi {
  outletId: string;
  date: string;
  totalSales: string;
  totalTax: string;
  grandTotal: string;
  totalTips: string;
  totalServiceCharge: string;
  handoverCount: number;
  handoverCashCounted: string;
  handoverTipPayout: string;
  handoverDigitalTips: string;
  paymentModes: Record<string, string>;
  invoiceCount: number;
}

// Real response shape of GET /ledger-entries (services/finance/src/ledger-engine.ts
// listLedgerEntries, serialized by apps/api/src/routes/finance.ts with bigint
// fields converted to strings).
interface LedgerEntryApi {
  id: string;
  sourceType: string;
  sourceId: string;
  account: string;
  debitMinor: string;
  creditMinor: string;
  externalRef: string | null;
  status: string;
  createdAt: string;
  postedAt: string | null;
}

// Real response shape of GET /refunds (services/finance/src/refund-service.ts
// listRefunds, serialized by apps/api/src/routes/finance.ts with bigint
// fields converted to strings).
interface RefundApi {
  id: string;
  orderId: string;
  paymentId: string;
  amountMinor: string;
  reasonCode: string;
  status: string;
  isPartial: boolean;
  createdAt: string;
}

interface PettyCashExpenseApi {
  id: string;
  amountMinor: string;
  category: string;
  description: string;
  paidTo: string;
  loggedBy: string;
  createdAt: string;
}

interface CashDrawerReconciliationApi {
  outletId: string;
  date: string;
  sessionId: string | null;
  sessionStatus: "OPEN" | "CLOSED" | "NONE" | string;
  openingFloatMinor: string;
  cashSalesMinor: string;
  cashRefundsMinor: string;
  pettyCashTotalMinor: string;
  expectedCashMinor: string;
  actualCashCountedMinor: string | null;
  varianceMinor: string;
  isReconciled: boolean;
  reconciledAt: string | null;
  reconciledBy: string | null;
  notes: string;
  cashTxCount: number;
  expenses: PettyCashExpenseApi[];
}

function daysAgoIso(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function FinancePage() {
  const { me, loading: authLoading } = useAuthGuard("report.read");
  const [date, setDate] = useState<string>(todayIso());
  const [report, setReport] = useState<ZReportApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState<string>(daysAgoIso(7));
  const [toDate, setToDate] = useState<string>(todayIso());
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntryApi[] | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundApi[] | null>(null);
  const [refundsLoading, setRefundsLoading] = useState(true);
  const [refundsError, setRefundsError] = useState<string | null>(null);

  const [cashDrawer, setCashDrawer] = useState<CashDrawerReconciliationApi | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(true);
  const [isPettyCashOpen, setIsPettyCashOpen] = useState(false);
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);

  const [pettyAmount, setPettyAmount] = useState("");
  const [pettyCategory, setPettyCategory] = useState("Raw Materials / Veggies");
  const [pettyPaidTo, setPettyPaidTo] = useState("");
  const [pettyDescription, setPettyDescription] = useState("");
  const [savingPetty, setSavingPetty] = useState(false);

  const [reconcileOpeningFloat, setReconcileOpeningFloat] = useState("2000");
  const [reconcileActualCount, setReconcileActualCount] = useState("");
  const [reconcileNotes, setReconcileNotes] = useState("");
  const [savingOpenShift, setSavingOpenShift] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [waiterHandovers, setWaiterHandovers] = useState<
    { id: string; waiterId: string; waiterName?: string; createdAt: string; actualCashCountedMinor: number; openingFloatMinor: number; netTipPayoutMinor: number; managerNotes: string }[]
  >([]);

  const fetchWaiterHandovers = () => {
    authedFetch("/waiters/shift-handovers")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => setWaiterHandovers(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchCashDrawer = () => {
    setDrawerLoading(true);
    authedFetch(`/finance/cash-drawer?date=${encodeURIComponent(date)}`)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<CashDrawerReconciliationApi>;
      })
      .then((data) => {
        setCashDrawer(data);
        setReconcileOpeningFloat((Number(data.openingFloatMinor || "200000") / 100).toString());
        setDrawerLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load cash drawer:", err);
        setCashDrawer(null);
        setDrawerLoading(false);
      });
  };

  const fetchReport = () => {
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    authedFetch(`/finance/z-report?date=${encodeURIComponent(date)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<ZReportApi>;
      })
      .then((data) => {
        clearTimeout(timeout);
        setReport(data);
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        setLoadError(err instanceof Error ? err.message : "Failed to load Z-report");
        setReport(null);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (authLoading) return;
    fetchReport();
    fetchCashDrawer();
    fetchWaiterHandovers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, date]);

  useKapmetaSocket(
    (payload) => {
      if (payload.topic === "finance.waiter_shift_handover" || payload.topic === "finance.order_settled") {
        fetchWaiterHandovers();
        fetchReport();
        fetchCashDrawer();
        fetchCashDrawer();
        fetchReport();
        if (payload.topic === "finance.waiter_shift_handover") {
          showToast("Captain cash & tips handover received");
        }
      }
    },
    !authLoading,
    "finance"
  );

  const handleSavePettyCash = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(pettyAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast("⚠️ Please enter a valid expense amount in ₹");
      return;
    }
    setSavingPetty(true);
    try {
      const res = await authedFetch("/finance/petty-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountMinor: String(Math.round(amountNum * 100)),
          category: pettyCategory,
          paidTo: pettyPaidTo,
          description: pettyDescription,
          date,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to log petty cash");
      }
      setIsPettyCashOpen(false);
      setPettyAmount("");
      setPettyPaidTo("");
      setPettyDescription("");
      showToast(`✅ Petty cash of ₹${amountNum.toFixed(2)} recorded`);
      fetchCashDrawer();
    } catch (err: any) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      setSavingPetty(false);
    }
  };

  const handleOpenShift = async () => {
    const floatNum = parseFloat(reconcileOpeningFloat);
    setSavingOpenShift(true);
    try {
      const res = await authedFetch("/finance/cash-drawer/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingFloatMinor: String(Math.round((isNaN(floatNum) ? 0 : floatNum) * 100)),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to open cash drawer");
      }
      showToast("✅ Cash drawer shift opened");
      fetchCashDrawer();
    } catch (err: any) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      setSavingOpenShift(false);
    }
  };

  const handleReconcileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const countNum = parseFloat(reconcileActualCount);
    const floatNum = parseFloat(reconcileOpeningFloat);
    if (isNaN(countNum) || countNum < 0) {
      showToast("⚠️ Please enter the counted physical cash amount in ₹");
      return;
    }
    setSavingReconcile(true);
    try {
      const res = await authedFetch("/finance/cash-drawer/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          openingFloatMinor: String(Math.round((isNaN(floatNum) ? 2000 : floatNum) * 100)),
          actualCashCountedMinor: String(Math.round(countNum * 100)),
          notes: reconcileNotes,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to submit reconciliation");
      }
      const data = await res.json();
      setIsReconcileOpen(false);
      setReconcileActualCount("");
      setReconcileNotes("");
      const varRupees = Number(BigInt(data.varianceMinor || "0")) / 100;
      showToast(`✅ Shift reconciled! Variance: ₹${varRupees.toFixed(2)}`);
      fetchCashDrawer();
    } catch (err: any) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      setSavingReconcile(false);
    }
  };

  const fetchLedgerEntries = () => {
    setLedgerLoading(true);
    setLedgerError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    authedFetch(
      `/finance/ledger-entries?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<LedgerEntryApi[]>;
      })
      .then((data) => {
        clearTimeout(timeout);
        setLedgerEntries(data);
        setLedgerLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        setLedgerError(err instanceof Error ? err.message : "Failed to load ledger entries");
        setLedgerEntries(null);
        setLedgerLoading(false);
      });
  };

  const fetchRefunds = () => {
    setRefundsLoading(true);
    setRefundsError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    authedFetch(
      `/finance/refunds?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<RefundApi[]>;
      })
      .then((data) => {
        clearTimeout(timeout);
        setRefunds(data);
        setRefundsLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        setRefundsError(err instanceof Error ? err.message : "Failed to load refunds");
        setRefunds(null);
        setRefundsLoading(false);
      });
  };

  useEffect(() => {
    if (authLoading) return;
    fetchLedgerEntries();
    fetchRefunds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, fromDate, toDate]);

  const formatMoney = (minor: any) => {
    if (minor === undefined || minor === null || minor === "") return "₹0.00";
    const paise = typeof minor === "bigint" ? Number(minor) : Number(minor);
    if (isNaN(paise)) return "₹0.00";
    return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const initials = me?.name
    ? me.name
        .split(" ")
        .map((p) => p.charAt(0))
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  const paymentModeEntries = report ? Object.entries(report.paymentModes) : [];

  return (
    <div className="admin-app">
      <Head>
        <title>Kapmeta POS - Finance & Z-Report</title>
        <meta name="description" content="Daily reconciliation / Z-report for the outlet." />
      </Head>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <Nav variant="sidebar" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-badge">
            <span className="brand-icon">⚡</span>
            <span className="brand-name">Kapmeta Finance</span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="user-profile-badge">
            <div className="avatar-circle">{initials}</div>
            <div className="user-info-text">
              <span className="user-name">{me?.name ?? "Loading..."}</span>
              <span className="user-role">{me?.roles?.[0] ?? ""}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="dashboard-body">
        {authLoading && (
          <div className="empty-state-card">
            <span className="empty-icon">🔐</span>
            <h3>Checking access...</h3>
          </div>
        )}

        {!authLoading && me && !me.permissions.includes("report.read") && (
          <div className="empty-state-card">
            <span className="empty-icon">🚫</span>
            <h3>No finance access</h3>
            <p>Your role does not grant the "report.read" permission required to view financial records.</p>
          </div>
        )}

        {!authLoading && me && me.permissions.includes("report.read") && (
          <>
            <section className="dashboard-greeting-row">
              <div>
                <span className="breadcrumb-line">Operations &gt; Finance</span>
                <h1 className="greeting-title">Daily Z-Report</h1>
                <p className="greeting-subtitle">
                  {loading
                    ? "Loading Z-report..."
                    : report
                    ? (
                        <>
                          <strong>{formatMoney(report.grandTotal)}</strong> settled across{" "}
                          <strong>{report.invoiceCount} invoices</strong> on {report.date}.
                        </>
                      )
                    : "No Z-report data available for the selected date."}
                </p>
              </div>

              <div className="date-controls-group">
                <input
                  type="date"
                  className="date-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </section>

            {loading && (
              <div className="empty-state-card">
                <span className="empty-icon">⏳</span>
                <h3>Loading Z-report...</h3>
              </div>
            )}

            {!loading && loadError && (
              <div className="empty-state-card">
                <span className="empty-icon">⚠️</span>
                <h3>Could not load Z-report</h3>
                <p>{loadError}. Check that the API is running and you are signed in.</p>
              </div>
            )}

            {!loading && !loadError && report && (
              <>
                <section className="kpi-cards-grid">
                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge green">
                        <span>₹</span>
                      </div>
                      <span className="kpi-heading">TOTAL SALES (EX. TAX)</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(report.totalSales)}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge amber">
                        <span>%</span>
                      </div>
                      <span className="kpi-heading">TOTAL TAX</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(report.totalTax)}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge purple">
                        <span>Σ</span>
                      </div>
                      <span className="kpi-heading">GRAND TOTAL</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(report.grandTotal)}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge blue">
                        <span>🧾</span>
                      </div>
                      <span className="kpi-heading">INVOICE COUNT</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{report.invoiceCount}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge green">
                        <span>✦</span>
                      </div>
                      <span className="kpi-heading">TIPS (BILL)</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(report.totalTips || "0")}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge amber">
                        <span>%</span>
                      </div>
                      <span className="kpi-heading">SERVICE CHARGE</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(report.totalServiceCharge || "0")}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge purple">
                        <span>₹</span>
                      </div>
                      <span className="kpi-heading">CAPTAIN TIP PAYOUT</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(report.handoverTipPayout || "0")}</h2>
                    </div>
                  </div>
                </section>

                {/* Cash Drawer Status & Petty Cash Reconciliation Panel */}
                <section className="panel-card" style={{ marginBottom: "24px" }}>
                  <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <h3 style={{ fontSize: "1.25rem", fontWeight: 800 }}>💵 Cash Drawer & Petty Cash Reconciliation</h3>
                      <p className="panel-sub">Real-time cash float, order collections, expense disbursements & shift closing variance</p>
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      {cashDrawer?.sessionStatus === "NONE" && (
                        <button
                          type="button"
                          onClick={handleOpenShift}
                          disabled={savingOpenShift}
                          style={{
                            padding: "8px 14px",
                            borderRadius: "var(--radius-md, 8px)",
                            border: "1px solid #86efac",
                            background: "#f0fdf4",
                            color: "#166534",
                            fontSize: "0.8125rem",
                            fontWeight: 700,
                            cursor: savingOpenShift ? "wait" : "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {savingOpenShift ? "Opening…" : "🔓 Open Shift"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsPettyCashOpen(true)}
                        style={{
                          padding: "8px 14px",
                          borderRadius: "var(--radius-md, 8px)",
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                          color: "#0f172a",
                          fontSize: "0.8125rem",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        💸 Log Petty Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsReconcileOpen(true)}
                        disabled={cashDrawer?.sessionStatus !== "OPEN"}
                        style={{
                          padding: "8px 14px",
                          borderRadius: "var(--radius-md, 8px)",
                          border: "none",
                          background: "#2563eb",
                          color: "#ffffff",
                          fontSize: "0.8125rem",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        🔒 Reconcile Shift
                      </button>
                    </div>
                  </div>

                  {drawerLoading && (
                    <div className="not-available-box">
                      <p>Loading cash drawer metrics...</p>
                    </div>
                  )}

                  {!drawerLoading && cashDrawer && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", margin: "16px 0" }}>
                        <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b" }}>OPENING FLOAT</span>
                          <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0f172a", marginTop: "4px" }}>
                            {formatMoney(cashDrawer.openingFloatMinor)}
                          </div>
                        </div>
                        <div style={{ background: "#f0fdf4", padding: "14px", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#166534" }}>CASH SALES INFLOW</span>
                          <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#15803d", marginTop: "4px" }}>
                            +{formatMoney(cashDrawer.cashSalesMinor)}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: "2px" }}>
                            {cashDrawer.cashTxCount} cash orders
                          </div>
                        </div>
                        <div style={{ background: "#fef2f2", padding: "14px", borderRadius: "8px", border: "1px solid #fecaca" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#991b1b" }}>PETTY CASH OUTFLOW</span>
                          <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#b91c1c", marginTop: "4px" }}>
                            -{formatMoney(cashDrawer.pettyCashTotalMinor)}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#991b1b", marginTop: "2px" }}>
                            {cashDrawer.expenses.length} expenses
                          </div>
                        </div>
                        <div style={{ background: "#eff6ff", padding: "14px", borderRadius: "8px", border: "1px solid #bfdbfe" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1e40af" }}>EXPECTED IN DRAWER</span>
                          <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#1d4ed8", marginTop: "4px" }}>
                            {formatMoney(cashDrawer.expectedCashMinor)}
                          </div>
                        </div>
                        <div style={{
                          background: cashDrawer.isReconciled ? (Number(cashDrawer.varianceMinor) === 0 ? "#f0fdf4" : (Number(cashDrawer.varianceMinor) < 0 ? "#fef2f2" : "#fefce8")) : "#f8fafc",
                          padding: "14px",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1"
                        }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569" }}>
                            {cashDrawer.isReconciled ? "ACTUAL COUNTED & VARIANCE" : "STATUS"}
                          </span>
                          {cashDrawer.isReconciled ? (
                            <div>
                              <div style={{ fontSize: "1.125rem", fontWeight: 900, marginTop: "2px" }}>
                                {formatMoney(cashDrawer.actualCashCountedMinor || "0")}
                              </div>
                              <span style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "0.75rem",
                                fontWeight: 800,
                                marginTop: "4px",
                                background: Number(cashDrawer.varianceMinor) === 0 ? "#dcfce7" : (Number(cashDrawer.varianceMinor) < 0 ? "#fee2e2" : "#fef9c3"),
                                color: Number(cashDrawer.varianceMinor) === 0 ? "#166534" : (Number(cashDrawer.varianceMinor) < 0 ? "#991b1b" : "#854d0e")
                              }}>
                                {Number(cashDrawer.varianceMinor) === 0 ? "✅ Balanced (₹0.00)" : (Number(cashDrawer.varianceMinor) < 0 ? `⚠️ Shortage (-₹${(Math.abs(Number(cashDrawer.varianceMinor)) / 100).toFixed(2)})` : `📈 Surplus (+₹${(Number(cashDrawer.varianceMinor) / 100).toFixed(2)})`)}
                              </span>
                            </div>
                          ) : (
                            <div style={{ marginTop: "6px" }}>
                              <span style={{ display: "inline-block", padding: "4px 8px", borderRadius: "4px", background: cashDrawer.sessionStatus === "OPEN" ? "#fef3c7" : "#e2e8f0", color: cashDrawer.sessionStatus === "OPEN" ? "#92400e" : "#334155", fontSize: "0.75rem", fontWeight: 800 }}>
                                {cashDrawer.sessionStatus === "OPEN"
                                  ? "⏳ Shift Open (Unreconciled)"
                                  : cashDrawer.sessionStatus === "CLOSED"
                                    ? "Shift closed"
                                    : "No open shift"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Petty Cash Outflows Table */}
                      <div style={{ marginTop: "16px" }}>
                        <h4 style={{ fontSize: "0.9375rem", fontWeight: 800, color: "#334155", margin: "0 0 10px" }}>
                          Today&apos;s Petty Cash Outflow Ledger
                        </h4>
                        {cashDrawer.expenses.length === 0 ? (
                          <div className="not-available-box" style={{ padding: "16px" }}>
                            <p>No petty cash expenses recorded for {cashDrawer.date}.</p>
                          </div>
                        ) : (
                          <div className="table-responsive">
                            <table className="clean-table">
                              <thead>
                                <tr>
                                  <th>Time</th>
                                  <th>Category</th>
                                  <th>Paid To</th>
                                  <th>Description</th>
                                  <th>Logged By</th>
                                  <th style={{ textAlign: "right" }}>Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cashDrawer.expenses.map((exp) => (
                                  <tr key={exp.id}>
                                    <td>{new Date(exp.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                                    <td>
                                      <span className="pill-status info" style={{ fontWeight: 700 }}>
                                        {exp.category}
                                      </span>
                                    </td>
                                    <td><strong>{exp.paidTo || "-"}</strong></td>
                                    <td>{exp.description || "-"}</td>
                                    <td style={{ color: "#64748b" }}>{exp.loggedBy}</td>
                                    <td className="amount-cell" style={{ color: "#dc2626", fontWeight: 800 }}>
                                      -{formatMoney(exp.amountMinor)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                      <div style={{ marginTop: "20px" }}>
                        <h4 style={{ fontSize: "0.9375rem", fontWeight: 800, color: "#334155", margin: "0 0 10px" }}>
                          Captain shift cash &amp; tips handovers
                        </h4>
                        <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "0 0 10px" }}>
                          From POST /waiters/me/shift-handover. Does not close the house cash drawer.
                        </p>
                        {waiterHandovers.length === 0 ? (
                          <div className="not-available-box" style={{ padding: "16px" }}>
                            <p>No captain handovers recorded yet.</p>
                          </div>
                        ) : (
                          <div className="table-responsive">
                            <table className="clean-table">
                              <thead>
                                <tr>
                                  <th>Time</th>
                                  <th>Captain</th>
                                  <th style={{ textAlign: "right" }}>Counted cash</th>
                                  <th style={{ textAlign: "right" }}>Opening float</th>
                                  <th style={{ textAlign: "right" }}>Net tip payout</th>
                                  <th>Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {waiterHandovers.map((h) => (
                                  <tr key={h.id}>
                                    <td>{new Date(h.createdAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</td>
                                    <td><strong>{h.waiterName || h.waiterId.slice(0, 8)}</strong></td>
                                    <td className="amount-cell">{formatMoney(String(h.actualCashCountedMinor))}</td>
                                    <td className="amount-cell">{formatMoney(String(h.openingFloatMinor))}</td>
                                    <td className="amount-cell" style={{ color: "#0f766e", fontWeight: 800 }}>{formatMoney(String(h.netTipPayoutMinor))}</td>
                                    <td style={{ color: "#64748b", fontSize: "0.75rem" }}>{h.managerNotes || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                </section>

                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Payment Mode Split</h3>
                      <p className="panel-sub">From GET /z-report for {report.date}</p>
                    </div>
                    <span className="total-badge">{paymentModeEntries.length} modes</span>
                  </div>

                  {paymentModeEntries.length === 0 && (
                    <div className="not-available-box">
                      <p>No captured payments recorded for this date.</p>
                    </div>
                  )}

                  {paymentModeEntries.length > 0 && (
                    <div className="table-responsive">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Payment Mode</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentModeEntries
                            .sort((a, b) => Number(b[1]) - Number(a[1]))
                            .map(([mode, amount]) => (
                              <tr key={mode}>
                                <td>
                                  <strong>{mode}</strong>
                                </td>
                                <td className="amount-cell">{formatMoney(amount)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Ledger Entries</h3>
                      <p className="panel-sub">From GET /ledger-entries for {fromDate} to {toDate}</p>
                    </div>
                    <div className="date-controls-group">
                      <input
                        type="date"
                        className="date-input"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                      />
                      <input
                        type="date"
                        className="date-input"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                      />
                      <span className="total-badge">{ledgerEntries?.length ?? 0} entries</span>
                    </div>
                  </div>

                  {ledgerLoading && (
                    <div className="not-available-box">
                      <p>Loading ledger entries...</p>
                    </div>
                  )}

                  {!ledgerLoading && ledgerError && (
                    <div className="not-available-box">
                      <p>Could not load ledger entries: {ledgerError}.</p>
                    </div>
                  )}

                  {!ledgerLoading && !ledgerError && (ledgerEntries?.length ?? 0) === 0 && (
                    <div className="not-available-box">
                      <p>No ledger entries recorded for this date range.</p>
                    </div>
                  )}

                  {!ledgerLoading && !ledgerError && ledgerEntries && ledgerEntries.length > 0 && (
                    <div className="table-responsive">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Source</th>
                            <th>Account</th>
                            <th>Debit</th>
                            <th>Credit</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerEntries.map((entry) => (
                            <tr key={entry.id}>
                              <td>{new Date(entry.createdAt).toLocaleDateString("en-IN")}</td>
                              <td>{entry.sourceType}</td>
                              <td>{entry.account}</td>
                              <td className="amount-cell">{formatMoney(entry.debitMinor)}</td>
                              <td className="amount-cell">{formatMoney(entry.creditMinor)}</td>
                              <td>{entry.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Refunds</h3>
                      <p className="panel-sub">From GET /refunds for {fromDate} to {toDate}</p>
                    </div>
                    <span className="total-badge">{refunds?.length ?? 0} refunds</span>
                  </div>

                  {refundsLoading && (
                    <div className="not-available-box">
                      <p>Loading refunds...</p>
                    </div>
                  )}

                  {!refundsLoading && refundsError && (
                    <div className="not-available-box">
                      <p>Could not load refunds: {refundsError}.</p>
                    </div>
                  )}

                  {!refundsLoading && !refundsError && (refunds?.length ?? 0) === 0 && (
                    <div className="not-available-box">
                      <p>No refunds recorded for this date range.</p>
                    </div>
                  )}

                  {!refundsLoading && !refundsError && refunds && refunds.length > 0 && (
                    <div className="table-responsive">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Order</th>
                            <th>Amount</th>
                            <th>Reason</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {refunds.map((refund) => (
                            <tr key={refund.id}>
                              <td>{new Date(refund.createdAt).toLocaleDateString("en-IN")}</td>
                              <td>{refund.orderId}</td>
                              <td className="amount-cell">{formatMoney(refund.amountMinor)}</td>
                              <td>{refund.reasonCode}</td>
                              <td>{refund.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}

            {!loading && !loadError && !report && (
              <div className="empty-state-card">
                <span className="empty-icon">📊</span>
                <h3>No Z-report data available</h3>
                <p>No settlement data was returned for {date}.</p>
              </div>
            )}
          </>
        )}

        {/* Modal: Log Petty Cash Outflow */}
        {isPettyCashOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "20px",
              backdropFilter: "blur(4px)",
            }}
            onClick={() => setIsPettyCashOpen(false)}
          >
            <div
              style={{
                background: "#ffffff",
                color: "#1e293b",
                width: "100%",
                maxWidth: "480px",
                borderRadius: "var(--radius-lg, 12px)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                padding: "24px",
                position: "relative",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: "0 0 12px", fontSize: "1.25rem", fontWeight: 800 }}>💸 Log Petty Cash Outflow</h3>
              <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: "0 0 16px" }}>
                Record day-to-day cash disbursements from the restaurant cash drawer.
              </p>
              <form onSubmit={handleSavePettyCash}>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Category *
                  </label>
                  <select
                    value={pettyCategory}
                    onChange={(e) => setPettyCategory(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff" }}
                  >
                    <option value="Raw Materials / Veggies">Raw Materials / Veggies</option>
                    <option value="Dairy & Milk">Dairy & Milk</option>
                    <option value="Cleaning Supplies">Cleaning Supplies</option>
                    <option value="Fuel & Delivery">Fuel & Delivery</option>
                    <option value="Staff Tea & Snacks">Staff Tea & Snacks</option>
                    <option value="Repairs & Maintenance">Repairs & Maintenance</option>
                    <option value="Miscellaneous">Miscellaneous</option>
                  </select>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    placeholder="250.00"
                    value={pettyAmount}
                    onChange={(e) => setPettyAmount(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Paid To / Vendor Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Local Dairy / Supermarket"
                    value={pettyPaidTo}
                    onChange={(e) => setPettyPaidTo(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Description / Purpose
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Brief description of the purchase"
                    value={pettyDescription}
                    onChange={(e) => setPettyDescription(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setIsPettyCashOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={savingPetty || !pettyAmount}
                    style={{ background: "#dc2626", color: "#ffffff", fontWeight: 700 }}
                  >
                    {savingPetty ? "Saving..." : "Record Outflow"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: End-of-Day Shift Close & Reconcile */}
        {isReconcileOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "20px",
              backdropFilter: "blur(4px)",
            }}
            onClick={() => setIsReconcileOpen(false)}
          >
            <div
              style={{
                background: "#ffffff",
                color: "#1e293b",
                width: "100%",
                maxWidth: "480px",
                borderRadius: "var(--radius-lg, 12px)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                padding: "24px",
                position: "relative",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: "0 0 12px", fontSize: "1.25rem", fontWeight: 800 }}>🔒 End-of-Day Cash Drawer Close</h3>
              <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: "0 0 16px" }}>
                Verify physical drawer cash against system records for {date}.
              </p>

              {cashDrawer && (
                <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", marginBottom: "16px", fontSize: "0.8125rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span>Opening Float:</span>
                    <strong>{formatMoney(cashDrawer.openingFloatMinor)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", color: "#16a34a" }}>
                    <span>+ Cash Order Sales:</span>
                    <span>+{formatMoney(cashDrawer.cashSalesMinor)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", color: "#dc2626" }}>
                    <span>- Petty Cash Spent:</span>
                    <span>-{formatMoney(cashDrawer.pettyCashTotalMinor)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "6px", borderTop: "1px solid #cbd5e1", fontWeight: 800 }}>
                    <span>Expected In Drawer:</span>
                    <span style={{ color: "#2563eb" }}>{formatMoney(cashDrawer.expectedCashMinor)}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleReconcileSubmit}>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Actual Physical Cash Counted (₹) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="Enter physical cash in drawer"
                    value={reconcileActualCount}
                    onChange={(e) => setReconcileActualCount(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "2px solid #2563eb", fontSize: "1rem", fontWeight: 700 }}
                  />
                  {reconcileActualCount && cashDrawer && (
                    <div style={{ marginTop: "6px", fontSize: "0.8125rem", fontWeight: 700 }}>
                      Calculated Variance:{" "}
                      <span style={{
                        color: (parseFloat(reconcileActualCount) * 100 - Number(cashDrawer.expectedCashMinor)) === 0 ? "#16a34a" : ((parseFloat(reconcileActualCount) * 100 - Number(cashDrawer.expectedCashMinor)) < 0 ? "#dc2626" : "#ca8a04")
                      }}>
                        ₹{((parseFloat(reconcileActualCount) * 100 - Number(cashDrawer.expectedCashMinor)) / 100).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Closing Remarks / Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Verified by shift manager, exact balance"
                    value={reconcileNotes}
                    onChange={(e) => setReconcileNotes(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setIsReconcileOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={savingReconcile || !reconcileActualCount}
                    style={{ background: "#2563eb", color: "#ffffff", fontWeight: 700 }}
                  >
                    {savingReconcile ? "Submitting..." : "Confirm & Lock Shift"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {toastMessage && (
          <div style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#0f172a",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "8px",
            fontWeight: 700,
            fontSize: "0.875rem",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)",
            zIndex: 9999,
          }}>
            {toastMessage}
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .admin-app {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          width: 100vw;
          background-color: var(--bg-base);
          color: var(--text-primary);
        }

        .topbar {
          height: 64px;
          background-color: var(--bg-card);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          position: sticky;
          top: 0;
          z-index: 20;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .brand-badge {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .brand-icon {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          background: var(--dark-btn);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
        }

        .brand-name {
          font-size: 1.125rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .user-profile-badge {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar-circle {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.8125rem;
        }

        .user-info-text {
          display: flex;
          flex-direction: column;
        }

        .user-name {
          font-size: 0.8125rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .user-role {
          font-size: 0.6875rem;
          color: var(--text-secondary);
        }

        .dashboard-body {
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 1500px;
          margin: 0 auto;
          width: 100%;
        }

        .dashboard-greeting-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding-bottom: 8px;
        }

        .breadcrumb-line {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .greeting-title {
          margin: 4px 0 2px 0;
          font-size: 1.75rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .greeting-subtitle {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .date-controls-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .date-input {
          padding: 8px 14px;
          border: 1px solid var(--border);
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-primary);
          background: var(--bg-card);
        }

        .kpi-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 18px;
        }

        .kpi-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-shadow: var(--shadow-card);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-pop);
        }

        .kpi-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .icon-badge {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.125rem;
          font-weight: 800;
        }

        .icon-badge.green {
          background: #ecfdf5;
          color: #065f46;
        }

        .icon-badge.blue {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .icon-badge.amber {
          background: #fffbeb;
          color: #92400e;
        }

        .icon-badge.purple {
          background: #faf5ff;
          color: #7e22ce;
        }

        .kpi-heading {
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }

        .kpi-main {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        .kpi-number {
          margin: 0;
          font-size: 1.875rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .panel-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          box-shadow: var(--shadow-card);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .panel-header h3 {
          margin: 0 0 2px 0;
          font-size: 1.125rem;
          font-weight: 800;
        }

        .panel-sub {
          margin: 0;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .pill-status {
          padding: 4px 10px;
          border-radius: var(--radius-pill);
          font-size: 0.75rem;
          font-weight: 700;
        }

        .pill-status.muted {
          background: var(--bg-subtle);
          color: var(--text-muted);
        }

        .not-available-box {
          background: var(--bg-subtle);
          border: 1px dashed var(--border);
          border-radius: var(--radius-md);
          padding: 16px;
          font-size: 0.8125rem;
          color: var(--text-secondary);
        }

        .not-available-box p {
          margin: 0;
        }

        .invoices-table-card {
          margin-bottom: 0;
        }

        .total-badge {
          font-size: 0.8125rem;
          color: var(--text-secondary);
          background: var(--bg-subtle);
          padding: 4px 10px;
          border-radius: var(--radius-pill);
        }

        .clean-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .clean-table th {
          padding: 12px 16px;
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.5px;
          text-transform: uppercase;
          border-bottom: 1px solid var(--border);
        }

        .clean-table td {
          padding: 14px 16px;
          font-size: 0.875rem;
          border-bottom: 1px solid var(--border-subtle);
        }

        .clean-table tr:hover td {
          background: var(--bg-subtle);
        }

        .amount-cell {
          font-weight: 800;
          color: var(--text-primary);
        }

        .empty-state-card {
          text-align: center;
          padding: 60px 20px;
          background: var(--bg-card);
          border: 1px dashed var(--border);
          border-radius: var(--radius-lg);
        }

        .empty-icon {
          font-size: 40px;
          display: block;
          margin-bottom: 12px;
        }
      ` }} />
      </div>
      </div>
    </div>
  );
}
