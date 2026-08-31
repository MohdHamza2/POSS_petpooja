import React, { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { authedFetch, useAuthGuard } from "../lib/auth";
import Nav from "../components/Nav";
import QuickLinks from "../components/QuickLinks";
import NotificationBell from "../components/NotificationBell";
import OutletSwitcher from "../components/OutletSwitcher";

// Real response shape of GET /sales-summary (services/reporting/src/reporting-service.ts
// SalesSummary, serialized by apps/api/src/routes/reporting.ts with bigint fields as strings).
interface SalesSummaryApi {
  outletId: string;
  fromDate: string;
  toDate: string;
  formulaVersion: string;
  orderCount: number;
  netSalesMinor: string;
  averageOrderValueMinor: string;
}

// Real response shape of GET /item-performance (ItemPerformanceRow[], netSalesMinor
// serialized as a string).
interface ItemPerformanceApi {
  menuItemId: string;
  menuItemName?: string;
  name?: string;
  quantitySold: number;
  netSalesMinor: string;
}

// Real response shape of GET /payment-breakdown (PaymentBreakdown, bigint fields as strings).
interface PaymentMethodBreakdownApi {
  method: string;
  amountMinor: string;
  count: number;
  percentage: number;
}

interface PaymentBreakdownApi {
  outletId: string;
  fromDate: string;
  toDate: string;
  formulaVersion: number;
  totalAmountMinor: string;
  methods: PaymentMethodBreakdownApi[];
}

// Real response shape of GET /channel-breakdown (ChannelBreakdown, bigint fields as strings).
interface ChannelBreakdownRowApi {
  orderType: string;
  orderCount: number;
  successfulOrderCount: number;
  cancelledOrderCount: number;
  netSalesMinor: string;
}

interface ChannelBreakdownApi {
  outletId: string;
  fromDate: string;
  toDate: string;
  formulaVersion: number;
  channels: ChannelBreakdownRowApi[];
  totalOrderCount: number;
  totalSuccessfulOrderCount: number;
  totalCancelledOrderCount: number;
}

// Real response shape of GET /table-turnaround (TableTurnaroundAverage).
interface TableTurnaroundApi {
  outletId: string;
  fromDate: string;
  toDate: string;
  formulaVersion: number;
  averageMinutes: number;
  qualifyingOrderCount: number;
}

interface LeakageReportApi {
  outletId: string;
  fromDate: string;
  toDate: string;
  formulaVersion: number;
  cancelledCount: number;
  modifiedCount: number;
  shiftedCount: number;
  reasonCodeBreakdown: Record<string, number>;
  invoiceReprintCount: number;
  totalReprints: number;
  invoiceWaivedOffCount: number;
  totalWaivedOffMinor: string;
  kotsNotBilledCount: number;
  estimatedRevenueAtRiskMinor: string;
}

interface TaxComponentBreakdownApi {
  componentName: string;
  ratePercent: number;
  taxableAmountMinor: string;
  taxCollectedMinor: string;
  percentageShare: number;
}

interface TaxBreakdownApi {
  outletId: string;
  fromDate: string;
  toDate: string;
  formulaVersion: number;
  totalTaxableSalesMinor: string;
  totalTaxCollectedMinor: string;
  effectiveTaxRatePercent: number;
  orderCount: number;
  components: TaxComponentBreakdownApi[];
}

interface TableSectionOccupancyApi {
  section: string;
  totalTables: number;
  occupiedTables: number;
  vacantTables: number;
  totalCapacity: number;
  occupiedCapacity: number;
  occupancyRatePercent: number;
}

interface TableOccupancyApi {
  outletId: string;
  totalTables: number;
  occupiedTables: number;
  vacantTables: number;
  occupancyRatePercent: number;
  totalCapacity: number;
  occupiedCapacity: number;
  capacityUtilizationPercent: number;
  sections: TableSectionOccupancyApi[];
}

interface InvoiceItemApi {
  id: string;
  name: string;
  quantity: number;
  priceMinor: string;
  totalMinor: string;
  isVeg: boolean;
}

interface RecentInvoiceApi {
  id: string;
  invoiceNumber: string;
  orderNumber: string;
  orderType: string;
  status: string;
  tableNumber: string | null;
  section: string | null;
  subtotalMinor: string;
  taxTotalMinor: string;
  discountTotalMinor: string;
  grandTotalMinor: string;
  paymentMethod: string;
  paymentStatus: string;
  itemCount: number;
  items: InvoiceItemApi[];
  createdAt: string;
}

type TimeRange = "Day" | "Month" | "Quarter" | "Year";

function rangeFor(timeRange: TimeRange): { fromDate: string; toDate: string } {
  const now = new Date();
  const toDate = now.toISOString();
  const from = new Date(now);
  if (timeRange === "Day") {
    from.setDate(from.getDate() - 1);
  } else if (timeRange === "Month") {
    from.setMonth(from.getMonth() - 1);
  } else if (timeRange === "Quarter") {
    from.setMonth(from.getMonth() - 3);
  } else {
    from.setFullYear(from.getFullYear() - 1);
  }
  return { fromDate: from.toISOString(), toDate };
}

export default function AdminDashboard() {
  const { me, loading: authLoading } = useAuthGuard("report.read");
  const [summary, setSummary] = useState<SalesSummaryApi | null>(null);
  const [items, setItems] = useState<ItemPerformanceApi[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdownApi | null>(null);
  const [channelBreakdown, setChannelBreakdown] = useState<ChannelBreakdownApi | null>(null);
  const [tableTurnaround, setTableTurnaround] = useState<TableTurnaroundApi | null>(null);
  const [leakageReport, setLeakageReport] = useState<LeakageReportApi | null>(null);
  const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdownApi | null>(null);
  const [tableOccupancy, setTableOccupancy] = useState<TableOccupancyApi | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoiceApi[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<RecentInvoiceApi | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("Day");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const getTodayStr = () => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  };

  const getDaysAgoStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split("T")[0];
  };

  const [selectedExportType, setSelectedExportType] = useState<string>("sales-summary");
  const [exportFromDate, setExportFromDate] = useState<string>(getDaysAgoStr(7));
  const [exportToDate, setExportToDate] = useState<string>(getTodayStr());
  const [exportSingleDate, setExportSingleDate] = useState<string>(getTodayStr());
  const [exportFormat, setExportFormat] = useState<"CSV" | "JSON">("CSV");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const convertToCSV = (type: string, data: any): string => {
    if (!data) return "";
    switch (type) {
      case "sales-summary":
        return [
          "Metric,Value",
          `Outlet ID,"${data.outletId || ""}"`,
          `From Date,"${data.fromDate || ""}"`,
          `To Date,"${data.toDate || ""}"`,
          `KPI Formula Version,"${data.formulaVersion || ""}"`,
          `Completed Order Count,${data.orderCount || 0}`,
          `Net Sales (Rs),${(Number(data.netSalesMinor || 0) / 100).toFixed(2)}`,
          `Average Order Value (Rs),${(Number(data.averageOrderValueMinor || 0) / 100).toFixed(2)}`
        ].join("\n");
      case "item-performance": {
        const rows = Array.isArray(data) ? data : [];
        const lines = ["Menu Item ID,Quantity Sold,Net Sales (Rs)"];
        rows.forEach((r: any) => {
          lines.push(`"${r.menuItemId}",${r.quantitySold},${(Number(r.netSalesMinor || 0) / 100).toFixed(2)}`);
        });
        return lines.join("\n");
      }
      case "payment-breakdown": {
        const methods = Array.isArray(data.methods) ? data.methods : [];
        const lines = [
          "Payment Method,Transaction Count,Total Amount (Rs),Percentage Share",
          ...methods.map((m: any) => 
            `"${m.method}",${m.count},${(Number(m.amountMinor || 0) / 100).toFixed(2)},${(m.percentage || 0).toFixed(2)}%`
          )
        ];
        return lines.join("\n");
      }
      case "channel-breakdown": {
        const channels = Array.isArray(data.channels) ? data.channels : [];
        const lines = [
          "Channel,Total Order Count,Successful Count,Cancelled Count,Net Sales (Rs)",
          ...channels.map((c: any) => 
            `"${c.orderType}",${c.orderCount},${c.successfulOrderCount},${c.cancelledOrderCount},${(Number(c.netSalesMinor || 0) / 100).toFixed(2)}`
          )
        ];
        return lines.join("\n");
      }
      case "table-turnaround":
        return [
          "Metric,Value",
          `Outlet ID,"${data.outletId || ""}"`,
          `From Date,"${data.fromDate || ""}"`,
          `To Date,"${data.toDate || ""}"`,
          `Average Turnaround (Minutes),${(data.averageMinutes || 0).toFixed(2)}`,
          `Qualifying Dine-In Orders,${data.qualifyingOrderCount || 0}`
        ].join("\n");
      case "leakage-report":
        return [
          "Metric,Value",
          `Outlet ID,"${data.outletId || ""}"`,
          `From Date,"${data.fromDate || ""}"`,
          `To Date,"${data.toDate || ""}"`,
          `KOTs Cancelled,${data.cancelledCount || 0}`,
          `KOTs Modified,${data.modifiedCount || 0}`,
          `KOTs Shifted,${data.shiftedCount || 0}`,
          `Invoice Reprint Count,${data.invoiceReprintCount || 0}`,
          `Total Reprints,${data.totalReprints || 0}`,
          `Invoice Waived-Off Count,${data.invoiceWaivedOffCount || 0}`,
          `Total Waived-Off (Rs),${(Number(data.totalWaivedOffMinor || 0) / 100).toFixed(2)}`,
          `Unbilled KOTs,${data.kotsNotBilledCount || 0}`,
          `Estimated Revenue At Risk (Rs),${(Number(data.estimatedRevenueAtRiskMinor || 0) / 100).toFixed(2)}`
        ].join("\n");
      case "tax-breakdown": {
        const comps = Array.isArray(data.components) ? data.components : [];
        const lines = [
          "Tax Component,Rate (%),Taxable Sales (Rs),Tax Collected (Rs),Share (%)",
          ...comps.map((c: any) =>
            `"${c.componentName}",${c.ratePercent}%,${(Number(c.taxableAmountMinor || 0) / 100).toFixed(2)},${(Number(c.taxCollectedMinor || 0) / 100).toFixed(2)},${(c.percentageShare || 0).toFixed(1)}%`
          ),
          "",
          `Total Taxable Turnover (Rs),${(Number(data.totalTaxableSalesMinor || 0) / 100).toFixed(2)}`,
          `Total GST Collected (Rs),${(Number(data.totalTaxCollectedMinor || 0) / 100).toFixed(2)}`,
          `Effective Tax Rate,${(data.effectiveTaxRatePercent || 0).toFixed(2)}%`
        ];
        return lines.join("\n");
      }
      case "invoices": {
        const invs = Array.isArray(data) ? data : [];
        const lines = [
          "Invoice Number,Order Number,Order Type,Table,Items Count,Subtotal (Rs),Tax (Rs),Grand Total (Rs),Payment Method,Date & Time",
          ...invs.map((inv: any) =>
            `"${inv.invoiceNumber}","${inv.orderNumber}","${inv.orderType}","${inv.tableNumber || '-'}",${inv.itemCount || 0},${(Number(inv.subtotalMinor || 0) / 100).toFixed(2)},${(Number(inv.taxTotalMinor || 0) / 100).toFixed(2)},${(Number(inv.grandTotalMinor || 0) / 100).toFixed(2)},"${inv.paymentMethod}","${inv.createdAt}"`
          )
        ];
        return lines.join("\n");
      }
      case "tally-export": {
        const vouchers = Array.isArray(data.vouchers) ? data.vouchers : [];
        const lines = ["Date,Voucher Number,Narration,Ledger Account,Entry Type,Amount (Rs)"];
        vouchers.forEach((v: any) => {
          const ledgers = Array.isArray(v.ledgers) ? v.ledgers : [];
          ledgers.forEach((l: any) => {
            lines.push(`"${v.date}","${v.voucherNumber}","${v.narration}","${l.account}","${l.isDebit ? 'DEBIT' : 'CREDIT'}",${(Number(l.amountMinor || 0) / 100).toFixed(2)}`);
          });
        });
        return lines.join("\n");
      }
      case "z-report": {
        const paymentModes = data.paymentModes ? Object.entries(data.paymentModes) : [];
        const lines = [
          "Metric,Value",
          `Outlet ID,"${data.outletId || ""}"`,
          `Date,"${data.date || ""}"`,
          `Invoice Count,${data.invoiceCount || 0}`,
          `Total Sales Excl. Tax (Rs),${(Number(data.totalSales || 0) / 100).toFixed(2)}`,
          `Total Tax (Rs),${(Number(data.totalTax || 0) / 100).toFixed(2)}`,
          `Grand Total (Rs),${(Number(data.grandTotal || 0) / 100).toFixed(2)}`,
          ...paymentModes.map(([mode, amt]) => `Payment Mode: ${mode},${(Number(amt) / 100).toFixed(2)}`)
        ];
        return lines.join("\n");
      }
      default:
        return "";
    }
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExporting(true);
    setExportFeedback(null);
    let url = "";
    if (selectedExportType === "tally-export") {
      url = `/reporting/tally-export?date=${encodeURIComponent(exportSingleDate)}`;
    } else if (selectedExportType === "z-report") {
      url = `/finance/z-report?date=${encodeURIComponent(exportSingleDate)}`;
    } else {
      url = `/reporting/${selectedExportType}?fromDate=${encodeURIComponent(exportFromDate)}&toDate=${encodeURIComponent(exportToDate)}`;
    }
    try {
      const res = await authedFetch(url);
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const payload = await res.json();
      let fileContent = "";
      let mimeType = "";
      let fileExtension = "";
      if (exportFormat === "JSON") {
        fileContent = JSON.stringify(payload, null, 2);
        mimeType = "application/json";
        fileExtension = "json";
      } else {
        fileContent = convertToCSV(selectedExportType, payload);
        mimeType = "text/csv";
        fileExtension = "csv";
      }
      const blob = new Blob([fileContent], { type: `${mimeType};charset=utf-8;` });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      const dateSuffix = selectedExportType === "tally-export" || selectedExportType === "z-report" 
        ? exportSingleDate 
        : `${exportFromDate}_to_${exportToDate}`;
      link.setAttribute("download", `${selectedExportType}_report_${dateSuffix}.${fileExtension}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
      setExportFeedback({ type: "success", message: `✅ Successfully exported ${selectedExportType} report!` });
    } catch (err: any) {
      console.error(err);
      setExportFeedback({ type: "error", message: `❌ Export failed: ${err.message}` });
    } finally {
      setIsExporting(false);
    }
  };

  const fetchReports = () => {
    setLoading(true);
    setLoadError(null);
    const { fromDate, toDate } = rangeFor(timeRange);
    const qs = `fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    Promise.allSettled([
      authedFetch(`/reporting/sales-summary?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<SalesSummaryApi>;
      }),
      authedFetch(`/reporting/item-performance?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<ItemPerformanceApi[]>;
      }),
      authedFetch(`/reporting/payment-breakdown?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<PaymentBreakdownApi>;
      }),
      authedFetch(`/reporting/channel-breakdown?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<ChannelBreakdownApi>;
      }),
      authedFetch(`/reporting/table-turnaround?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<TableTurnaroundApi>;
      }),
      authedFetch(`/reporting/leakage-report?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<LeakageReportApi>;
      }),
      authedFetch(`/reporting/tax-breakdown?${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<TaxBreakdownApi>;
      }),
      authedFetch(`/tables/occupancy`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<TableOccupancyApi>;
      }),
      authedFetch(`/reporting/invoices?limit=100&${qs}`, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<RecentInvoiceApi[]>;
      }),
    ])
      .then((results) => {
        clearTimeout(timeout);
        const value = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
          r.status === "fulfilled" ? r.value : fallback;
        const [summaryRes, itemsRes, paymentRes, channelRes, ttaRes, leakageRes, taxRes, occupancyRes, invoicesRes] = results;
        setSummary(value(summaryRes, null as SalesSummaryApi | null));
        setItems(value(itemsRes, [] as ItemPerformanceApi[]));
        setPaymentBreakdown(value(paymentRes, null as PaymentBreakdownApi | null));
        setChannelBreakdown(value(channelRes, null as ChannelBreakdownApi | null));
        setTableTurnaround(value(ttaRes, null as TableTurnaroundApi | null));
        setLeakageReport(value(leakageRes, null as LeakageReportApi | null));
        setTaxBreakdown(value(taxRes, null as TaxBreakdownApi | null));
        setTableOccupancy(value(occupancyRes, null as TableOccupancyApi | null));
        setRecentInvoices(value(invoicesRes, [] as RecentInvoiceApi[]));
        const failed = results.filter((r) => r.status === "rejected");
        setLoadError(failed.length === results.length ? "Failed to load reports" : null);
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        setLoadError(err instanceof Error ? err.message : "Failed to load reports");
        setSummary(null);
        setItems([]);
        setPaymentBreakdown(null);
        setChannelBreakdown(null);
        setTableTurnaround(null);
        setLeakageReport(null);
        setTaxBreakdown(null);
        setTableOccupancy(null);
        setRecentInvoices([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (authLoading) return;
    fetchReports();
    const interval = setInterval(fetchReports, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, timeRange]);

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

  const topItems = [...items].sort((a, b) => Number(b.netSalesMinor) - Number(a.netSalesMinor)).slice(0, 10);

  return (
    <div className="admin-app">
      <Head>
        <title>Kapmeta POS - Executive Sales & Operations Analytics</title>
        <meta
          name="description"
          content="Executive financial analytics, settled orders, and revenue breakdowns."
        />
      </Head>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <Nav variant="sidebar" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Top Bar Header */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-badge">
            <span className="brand-icon">⚡</span>
            <span className="brand-name">Kapmeta Analytics</span>
          </div>
        </div>

        <div className="topbar-right">
          <OutletSwitcher />
          <QuickLinks />
          <NotificationBell />
          <div className="user-profile-badge">
            <div className="avatar-circle">{initials}</div>
            <div className="user-info-text">
              <span className="user-name">{me?.name ?? "Loading..."}</span>
              <span className="user-role">{me?.roles?.[0] ?? ""}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="dashboard-body">
        {authLoading && (
          <div className="empty-state-card">
            <span className="empty-icon">🔐</span>
            <h3>Checking access...</h3>
          </div>
        )}

        {!authLoading && (
          <>
            {/* Header Greeting & Controls */}
            <section className="dashboard-greeting-row">
              <div>
                <span className="breadcrumb-line">Operations &gt; Financial Reports</span>
                <h1 className="greeting-title">Good morning, {me?.name ?? "there"}</h1>
                <p className="greeting-subtitle">
                  {loading
                    ? "Loading sales figures..."
                    : summary
                    ? (
                        <>
                          <strong>{formatMoney(summary.netSalesMinor)}</strong> net sales across{" "}
                          <strong>{summary.orderCount} orders</strong> for the selected period.
                        </>
                      )
                    : "No sales data available for the selected period."}
                </p>
              </div>

              <div className="date-controls-group">
                <div className="timeframe-toggle">
                  {(["Day", "Month", "Quarter", "Year"] as const).map((t) => (
                    <button
                      key={t}
                      className={`tf-btn ${timeRange === t ? "active" : ""}`}
                      onClick={() => setTimeRange(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button className="export-btn" onClick={() => window.print()}>
                  📥 Export Report
                </button>
              </div>
            </section>

            {/* Reports Generator & ERP Export Console */}
            <section className="panel-card" style={{ marginBottom: "24px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "24px" }}>
              <div className="panel-header" style={{ marginBottom: "20px" }}>
                <div>
                  <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--text-primary)" }}>📊 Enterprise Reports Generator</h3>
                  <p className="panel-sub">Generate and download standard operations and accounting reports for the entire application.</p>
                </div>
              </div>

              <form onSubmit={handleExport} style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "220px" }}>
                  <label htmlFor="exportType" style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>Report Type</label>
                  <select
                    id="exportType"
                    value={selectedExportType}
                    onChange={(e) => setSelectedExportType(e.target.value)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border)",
                      background: "var(--bg-base)",
                      color: "var(--text-primary)",
                      fontWeight: 600,
                      minHeight: "44px",
                    }}
                  >
                    <option value="sales-summary">Gross / Net Sales Summary</option>
                    <option value="item-performance">Menu Item Performance</option>
                    <option value="payment-breakdown">Payment Method Breakdown</option>
                    <option value="channel-breakdown">Channel Sales Breakdown</option>
                    <option value="table-turnaround">Table Turnaround Average</option>
                    <option value="leakage-report">Leakage & Loss Detection</option>
                    <option value="tax-breakdown">GST Statutory Tax Breakdown</option>
                    <option value="invoices">Settled Invoices Ledger (CSV)</option>
                    <option value="tally-export">Tally ERP Voucher Export</option>
                    <option value="z-report">Daily Z-Report</option>
                  </select>
                </div>

                {(selectedExportType === "tally-export" || selectedExportType === "z-report") ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "160px" }}>
                    <label htmlFor="exportSingleDate" style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>Report Date</label>
                    <input
                      id="exportSingleDate"
                      type="date"
                      value={exportSingleDate}
                      onChange={(e) => setExportSingleDate(e.target.value)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: "var(--bg-base)",
                        color: "var(--text-primary)",
                        fontWeight: 600,
                        minHeight: "44px",
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "160px" }}>
                      <label htmlFor="exportFromDate" style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>From Date</label>
                      <input
                        id="exportFromDate"
                        type="date"
                        value={exportFromDate}
                        onChange={(e) => setExportFromDate(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border)",
                          background: "var(--bg-base)",
                          color: "var(--text-primary)",
                          fontWeight: 600,
                          minHeight: "44px",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "160px" }}>
                      <label htmlFor="exportToDate" style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>To Date</label>
                      <input
                        id="exportToDate"
                        type="date"
                        value={exportToDate}
                        onChange={(e) => setExportToDate(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border)",
                          background: "var(--bg-base)",
                          color: "var(--text-primary)",
                          fontWeight: 600,
                          minHeight: "44px",
                        }}
                      />
                    </div>
                  </>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "120px" }}>
                  <label htmlFor="exportFormat" style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>Format</label>
                  <select
                    id="exportFormat"
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as "CSV" | "JSON")}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border)",
                      background: "var(--bg-base)",
                      color: "var(--text-primary)",
                      fontWeight: 600,
                      minHeight: "44px",
                    }}
                  >
                    <option value="CSV">CSV (Excel)</option>
                    <option value="JSON">JSON Data</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isExporting}
                  style={{
                    padding: "10px 24px",
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    minHeight: "44px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isExporting ? "Generating..." : "📥 Download"}
                </button>
              </form>

              {exportFeedback && (
                <div style={{
                  marginTop: "16px",
                  padding: "12px 16px",
                  borderRadius: "var(--radius-md)",
                  background: exportFeedback.type === "success" ? "var(--accent-subtle)" : "var(--destructive-subtle)",
                  color: exportFeedback.type === "success" ? "var(--accent-subtle-text)" : "var(--destructive-text)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                }}>
                  {exportFeedback.message}
                </div>
              )}
            </section>

            {loading && (
              <div className="empty-state-card">
                <span className="empty-icon">⏳</span>
                <h3>Loading reports...</h3>
              </div>
            )}

            {!loading && loadError && (
              <div className="empty-state-card">
                <span className="empty-icon">⚠️</span>
                <h3>Could not load reports</h3>
                <p>{loadError}. Check that the API is running and you are signed in.</p>
              </div>
            )}

            {!loading && !loadError && !summary && (
              <div className="empty-state-card">
                <span className="empty-icon">📊</span>
                <h3>No report data available</h3>
                <p>No sales-summary data was returned for the selected period.</p>
              </div>
            )}

            {!loading && !loadError && summary && (
              <>
                {/* KPI Grid — only real fields from /sales-summary */}
                <section className="kpi-cards-grid">
                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge green">
                        <span>₹</span>
                      </div>
                      <span className="kpi-heading">NET SALES</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(summary.netSalesMinor)}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge amber">
                        <span>🧾</span>
                      </div>
                      <span className="kpi-heading">COMPLETED ORDERS</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{summary.orderCount}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge purple">
                        <span>📈</span>
                      </div>
                      <span className="kpi-heading">AVG. ORDER VALUE</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">{formatMoney(summary.averageOrderValueMinor)}</h2>
                    </div>
                  </div>

                  <div className="kpi-card">
                    <div className="kpi-top">
                      <div className="icon-badge blue">
                        <span>👥</span>
                      </div>
                      <span className="kpi-heading">TABLE OCCUPANCY RATE</span>
                    </div>
                    <div className="kpi-main">
                      <h2 className="kpi-number">
                        {tableOccupancy ? `${tableOccupancy.occupancyRatePercent.toFixed(1)}%` : "0.0%"}
                      </h2>
                      <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: (tableOccupancy?.occupiedTables ?? 0) > 0 ? "var(--accent)" : "#10b981" }}></span>
                        <span>{tableOccupancy?.occupiedTables ?? 0} of {tableOccupancy?.totalTables ?? 0} tables occupied</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Middle Two-Column Grid — payment breakdown from GET /payment-breakdown;
                    GST is not exposed by the reporting API yet. */}
                <section className="two-col-grid">
                  <div className="panel-card">
                    <div className="panel-header">
                      <div>
                        <h3>Payment Methods & Settlement Split</h3>
                        <p className="panel-sub">From GET /payment-breakdown for the selected period</p>
                      </div>
                      <span className="total-badge">{formatMoney(paymentBreakdown?.totalAmountMinor ?? "0")}</span>
                    </div>
                    {(!paymentBreakdown || paymentBreakdown.methods.length === 0) && (
                      <div className="not-available-box">
                        <p>No captured payments recorded for the selected period.</p>
                      </div>
                    )}
                    {paymentBreakdown && paymentBreakdown.methods.length > 0 && (
                      <div className="table-responsive">
                        <table className="clean-table">
                          <thead>
                            <tr>
                              <th>Method</th>
                              <th>Payments</th>
                              <th>Amount</th>
                              <th>Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...paymentBreakdown.methods]
                              .sort((a, b) => Number(b.amountMinor) - Number(a.amountMinor))
                              .map((m) => (
                                <tr key={m.method}>
                                  <td>
                                    <strong>{m.method}</strong>
                                  </td>
                                  <td>{m.count}</td>
                                  <td className="amount-cell">{formatMoney(m.amountMinor)}</td>
                                  <td>{m.percentage.toFixed(1)}%</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="panel-card">
                    <div className="panel-header">
                      <div>
                        <h3>GST Statutory Audit</h3>
                        <p className="panel-sub">Statutory tax liabilities & GST slab breakdown</p>
                      </div>
                      <span className="total-badge">{formatMoney(taxBreakdown?.totalTaxCollectedMinor ?? "0")}</span>
                    </div>
                    {(!taxBreakdown || taxBreakdown.components.length === 0 || Number(taxBreakdown.totalTaxCollectedMinor) === 0) && (
                      <div className="not-available-box">
                        <p>No tax liabilities recorded for the selected period.</p>
                      </div>
                    )}
                    {taxBreakdown && Number(taxBreakdown.totalTaxCollectedMinor) > 0 && (
                      <div className="table-responsive">
                        <table className="clean-table">
                          <thead>
                            <tr>
                              <th>Component</th>
                              <th>Rate</th>
                              <th>Taxable Basis</th>
                              <th>Tax Collected</th>
                              <th>Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {taxBreakdown.components.map((c) => (
                              <tr key={c.componentName}>
                                <td>
                                  <strong>{c.componentName}</strong>
                                </td>
                                <td>{c.ratePercent}%</td>
                                <td className="amount-cell">{formatMoney(c.taxableAmountMinor)}</td>
                                <td className="amount-cell">{formatMoney(c.taxCollectedMinor)}</td>
                                <td>{c.percentageShare.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ padding: "12px 16px", background: "var(--bg-base)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                          <span>Effective Rate: <strong>{taxBreakdown.effectiveTaxRatePercent}%</strong></span>
                          <span>Taxable Turnover: <strong>{formatMoney(taxBreakdown.totalTaxableSalesMinor)}</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Item Performance — real data from /item-performance */}
                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Top Items by Net Sales</h3>
                      <p className="panel-sub">From GET /item-performance for the selected period</p>
                    </div>
                    <span className="total-badge">{items.length} items sold</span>
                  </div>

                  {topItems.length === 0 && (
                    <div className="not-available-box">
                      <p>No item sales recorded for the selected period.</p>
                    </div>
                  )}

                  {topItems.length > 0 && (
                    <div className="table-responsive">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Dish / Menu Item</th>
                            <th>Quantity Sold</th>
                            <th>Net Sales</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topItems.map((it) => (
                            <tr key={it.menuItemId}>
                              <td>
                                <strong>{it.menuItemName || it.name || it.menuItemId}</strong>
                              </td>
                              <td>{it.quantitySold}</td>
                              <td className="amount-cell">{formatMoney(it.netSalesMinor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Channel Breakdown — real data from /channel-breakdown */}
                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Sales by Order Channel</h3>
                      <p className="panel-sub">From GET /channel-breakdown for the selected period</p>
                    </div>
                    <span className="total-badge">
                      {channelBreakdown?.totalSuccessfulOrderCount ?? 0} successful /{" "}
                      {channelBreakdown?.totalCancelledOrderCount ?? 0} cancelled
                    </span>
                  </div>

                  {tableTurnaround && tableTurnaround.qualifyingOrderCount > 0 && (
                    <p className="panel-sub">
                      Dine In table turnaround average (T.T.A): {tableTurnaround.averageMinutes.toFixed(1)} min
                      {" "}across {tableTurnaround.qualifyingOrderCount} settled table order(s)
                    </p>
                  )}

                  {(!channelBreakdown || channelBreakdown.channels.length === 0) && (
                    <div className="not-available-box">
                      <p>No orders recorded for the selected period.</p>
                    </div>
                  )}

                  {channelBreakdown && channelBreakdown.channels.length > 0 && (
                    <div className="table-responsive">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Channel</th>
                            <th>Total Orders</th>
                            <th>Successful</th>
                            <th>Cancelled</th>
                            <th>Net Sales</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...channelBreakdown.channels]
                            .sort((a, b) => b.orderCount - a.orderCount)
                            .map((c) => (
                              <tr key={c.orderType}>
                                <td>
                                  <strong>{c.orderType}</strong>
                                </td>
                                <td>{c.orderCount}</td>
                                <td>{c.successfulOrderCount}</td>
                                <td>{c.cancelledOrderCount}</td>
                                <td className="amount-cell">{formatMoney(c.netSalesMinor)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Leakage — real data from /leakage-report (Phase B anomaly/loss detection) */}
                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Leakage & Loss Detection</h3>
                      <p className="panel-sub">From GET /leakage-report for the selected period</p>
                    </div>
                    <span className="total-badge">
                      {leakageReport?.kotsNotBilledCount ?? 0} unbilled KOT(s)
                    </span>
                  </div>

                  {!leakageReport && (
                    <div className="not-available-box">
                      <p>No leakage data available for the selected period.</p>
                    </div>
                  )}

                  {leakageReport && (
                    <>
                      <div className="kpi-cards-grid">
                        <div className="kpi-card">
                          <div className="kpi-top">
                            <div className="icon-badge amber">
                              <span>🚫</span>
                            </div>
                            <span className="kpi-heading">KOT CANCELLED / MODIFIED / SHIFTED</span>
                          </div>
                          <div className="kpi-main">
                            <h2 className="kpi-number">
                              {leakageReport.cancelledCount + leakageReport.modifiedCount + leakageReport.shiftedCount}
                            </h2>
                          </div>
                        </div>

                        <div className="kpi-card">
                          <div className="kpi-top">
                            <div className="icon-badge purple">
                              <span>🖨️</span>
                            </div>
                            <span className="kpi-heading">BILL REPRINTS</span>
                          </div>
                          <div className="kpi-main">
                            <h2 className="kpi-number">{leakageReport.totalReprints}</h2>
                          </div>
                        </div>

                        <div className="kpi-card">
                          <div className="kpi-top">
                            <div className="icon-badge blue">
                              <span>🧾</span>
                            </div>
                            <span className="kpi-heading">WAIVED-OFF INVOICES</span>
                          </div>
                          <div className="kpi-main">
                            <h2 className="kpi-number">{leakageReport.invoiceWaivedOffCount}</h2>
                          </div>
                        </div>

                        <div className="kpi-card muted">
                          <div className="kpi-top">
                            <div className="icon-badge green">
                              <span>₹</span>
                            </div>
                            <span className="kpi-heading">REVENUE AT RISK (UNBILLED KOTS)</span>
                          </div>
                          <div className="kpi-main">
                            <h2 className="kpi-number">{formatMoney(leakageReport.estimatedRevenueAtRiskMinor)}</h2>
                          </div>
                        </div>
                      </div>

                      <div className="table-responsive">
                        <table className="clean-table">
                          <thead>
                            <tr>
                              <th>Metric</th>
                              <th>Count</th>
                              <th>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td><strong>KOT Cancelled</strong></td>
                              <td>{leakageReport.cancelledCount}</td>
                              <td className="amount-cell">—</td>
                            </tr>
                            <tr>
                              <td><strong>KOT Modified</strong></td>
                              <td>{leakageReport.modifiedCount}</td>
                              <td className="amount-cell">—</td>
                            </tr>
                            <tr>
                              <td><strong>KOT Shifted</strong></td>
                              <td>{leakageReport.shiftedCount}</td>
                              <td className="amount-cell">—</td>
                            </tr>
                            <tr>
                              <td><strong>Invoices Reprinted</strong></td>
                              <td>{leakageReport.invoiceReprintCount}</td>
                              <td className="amount-cell">{leakageReport.totalReprints} total reprints</td>
                            </tr>
                            <tr>
                              <td><strong>Invoices Waived Off</strong></td>
                              <td>{leakageReport.invoiceWaivedOffCount}</td>
                              <td className="amount-cell">{formatMoney(leakageReport.totalWaivedOffMinor)}</td>
                            </tr>
                            <tr>
                              <td><strong>KOTs Not Billed</strong></td>
                              <td>{leakageReport.kotsNotBilledCount}</td>
                              <td className="amount-cell">{formatMoney(leakageReport.estimatedRevenueAtRiskMinor)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>

                {/* Recent Settled Invoices — real data from /reporting/invoices */}
                <section className="panel-card invoices-table-card">
                  <div className="panel-header">
                    <div>
                      <h3>Recent Settled Invoices</h3>
                      <p className="panel-sub">Audited settled bills, payment modes & receipt reprint feed</p>
                    </div>
                    <span className="total-badge">{recentInvoices.length} settled bills</span>
                  </div>

                  {recentInvoices.length === 0 && (
                    <div className="not-available-box">
                      <p>No settled invoices recorded for the selected period.</p>
                    </div>
                  )}

                  {recentInvoices.length > 0 && (
                    <div className="table-responsive">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Invoice / Order #</th>
                            <th>Channel / Table</th>
                            <th>Items</th>
                            <th>Subtotal</th>
                            <th>GST Tax</th>
                            <th>Grand Total</th>
                            <th>Payment</th>
                            <th>Settled At</th>
                            <th>Receipt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentInvoices.map((inv) => (
                            <tr key={inv.id}>
                              <td>
                                <strong>{inv.invoiceNumber}</strong>
                                {inv.orderNumber && inv.orderNumber !== inv.invoiceNumber && (
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Ref: {inv.orderNumber}</div>
                                )}
                              </td>
                              <td>
                                <span className="pill-status info" style={{ textTransform: "capitalize" }}>
                                  {inv.orderType.toLowerCase()} {inv.tableNumber ? `(${inv.tableNumber})` : ""}
                                </span>
                              </td>
                              <td>{inv.itemCount} items</td>
                              <td className="amount-cell">{formatMoney(inv.subtotalMinor)}</td>
                              <td className="amount-cell">{formatMoney(inv.taxTotalMinor)}</td>
                              <td className="amount-cell"><strong>{formatMoney(inv.grandTotalMinor)}</strong></td>
                              <td>
                                <span className="pill-status success" style={{ fontWeight: 700 }}>
                                  {inv.paymentMethod}
                                </span>
                              </td>
                              <td style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                                {new Date(inv.createdAt).toLocaleString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => setSelectedInvoice(inv)}
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: "var(--radius-sm)",
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-base)",
                                    color: "var(--text-primary)",
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  👁️ View Receipt
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {/* Receipt Audit & Thermal Print Modal */}
        {selectedInvoice && (
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
            onClick={() => setSelectedInvoice(null)}
          >
            <div
              style={{
                background: "#ffffff",
                color: "#1e293b",
                width: "100%",
                maxWidth: "380px",
                borderRadius: "var(--radius-lg)",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                padding: "24px",
                fontFamily: "monospace, monospace",
                position: "relative",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ textAlign: "center", borderBottom: "2px dashed #cbd5e1", paddingBottom: "16px", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.5px", color: "#0f172a" }}>
                  {me?.outletName || "PETPOOJA RESTAURANT"}
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#64748b" }}>TAX INVOICE / AUDIT RECEIPT</p>
                <div style={{ marginTop: "8px", fontSize: "0.75rem", color: "#334155" }}>
                  <div>Invoice: <strong>{selectedInvoice.invoiceNumber}</strong></div>
                  <div>Date: {new Date(selectedInvoice.createdAt).toLocaleString("en-IN")}</div>
                  <div>Type: <strong>{selectedInvoice.orderType}</strong> {selectedInvoice.tableNumber ? `| Table: ${selectedInvoice.tableNumber}` : ""}</div>
                </div>
              </div>

              <div style={{ borderBottom: "1px dashed #cbd5e1", paddingBottom: "12px", marginBottom: "12px" }}>
                <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
                      <th style={{ textAlign: "left", paddingBottom: "4px" }}>Item</th>
                      <th style={{ textAlign: "center", paddingBottom: "4px" }}>Qty</th>
                      <th style={{ textAlign: "right", paddingBottom: "4px" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.items.map((it) => (
                      <tr key={it.id}>
                        <td style={{ padding: "4px 0" }}>{it.name}</td>
                        <td style={{ textAlign: "center", padding: "4px 0" }}>{it.quantity}</td>
                        <td style={{ textAlign: "right", padding: "4px 0" }}>{formatMoney(it.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: "0.8125rem", lineHeight: "1.6", borderBottom: "2px dashed #cbd5e1", paddingBottom: "12px", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Taxable Subtotal:</span>
                  <strong>{formatMoney(selectedInvoice.subtotalMinor)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b" }}>
                  <span>CGST (2.5%):</span>
                  <span>{formatMoney(BigInt(Math.floor(Number(selectedInvoice.taxTotalMinor) / 2)))}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b" }}>
                  <span>SGST (2.5%):</span>
                  <span>{formatMoney(BigInt(Math.ceil(Number(selectedInvoice.taxTotalMinor) / 2)))}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1rem", fontWeight: 900, marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e2e8f0", color: "#0f172a" }}>
                  <span>GRAND TOTAL:</span>
                  <span>{formatMoney(selectedInvoice.grandTotalMinor)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#16a34a", marginTop: "4px", fontWeight: 700 }}>
                  <span>PAYMENT METHOD:</span>
                  <span>{selectedInvoice.paymentMethod} (CAPTURED)</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button
                  type="button"
                  onClick={() => window.print()}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  🖨️ Print Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#475569",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
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

        .nav-pill-group {
          display: flex;
          background-color: var(--bg-subtle);
          padding: 4px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border);
          gap: 4px;
        }

        .nav-item {
          padding: 6px 16px;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-decoration: none;
          transition: all 0.15s ease;
        }

        .nav-item:hover {
          color: var(--text-primary);
        }

        .nav-item.active {
          background-color: var(--bg-card);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
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

        /* Dashboard Body */
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

        .timeframe-toggle {
          display: flex;
          background: var(--bg-card);
          border: 1px solid var(--border);
          padding: 3px;
          border-radius: var(--radius-pill);
        }

        .tf-btn {
          padding: 6px 14px;
          border: none;
          background: transparent;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
        }

        .tf-btn.active {
          background: var(--dark-btn);
          color: #fff;
        }

        .export-btn {
          padding: 8px 18px;
          background: var(--dark-btn);
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
          min-height: 38px;
        }

        /* KPI Cards */
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

        .kpi-card.muted {
          opacity: 0.7;
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

        .kpi-number.na {
          font-size: 1.125rem;
          color: var(--text-muted);
        }

        /* Two-Col Grid */
        .two-col-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 20px;
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

        /* Invoices / Items Table */
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
