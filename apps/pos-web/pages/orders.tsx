// Order history views for pos-web: Live Orders / All Orders / Online Orders,
// driven by GET /orders with PetPooja universal top navigation header.
import React, { useEffect, useState, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { authedFetch, useAuthGuard } from "../lib/auth";
import PetPoojaHeader from "../components/PetPoojaHeader";
import AggregatorOrdersView from "../components/AggregatorOrdersView";

type Tab = "live" | "all" | "online";
type LiveSubTab = "orders" | "tables";

const RUNNING_ORDER_ROWS: { type: string; label: string }[] = [
  { type: "DINE_IN", label: "Dine in" },
  { type: "PICKUP", label: "Takeaway" },
  { type: "DELIVERY", label: "Delivery" },
];

interface OrderSummaryDto {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  grandTotalMinor: string;
  taxTotalMinor: string;
  discountTotalMinor: string;
  createdAt: string;
  itemCount: number;
  diningTableId: string | null;
  channel: string | null;
  externalOrderId: string | null;
  priceMismatch: boolean;
  customerName: string | null;
  waiterName: string | null;
  paymentMethod: string | null;
}

interface RevenueTrendPointDto {
  date: string;
  grandTotalMinor: string;
}

const ORDER_TYPE_OPTIONS = ["DINE_IN", "PICKUP", "DELIVERY"];
const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: "Dine-In",
  TAKEAWAY: "Takeaway",
  PICKUP: "Takeaway",
  DELIVERY: "Delivery",
};
const PAGE_SIZE = 10;

function businessDateIso(): string {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 0, 0);
  const d = now < startToday
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : now;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CHANNEL_COLORS: Record<string, { bg: string; text: string }> = {
  SWIGGY: { bg: "#fff4e8", text: "#fc8019" },
  ZOMATO: { bg: "#fdeced", text: "#e23744" },
};

interface TableDto {
  id: string;
  tableNumber: string;
  capacity: number;
  section: string | null;
  isActive: boolean;
}

interface OrderDetailDto extends OrderSummaryDto {
  subtotalMinor: string;
  taxTotalMinor: string;
  discountTotalMinor: string;
  terminalNumber: string;
  diningTableId: string | null;
  customerId: string | null;
  items: {
    id: string;
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    unitPriceMinor: string;
    subtotalMinor: string;
    notes: string | null;
    modifiers: { modifierOptionId: string; priceMinor: string }[];
  }[];
  payments: { id: string; amountMinor: string; method: string; status: string; transactionId: string | null; createdAt: string }[];
  statusHistory: { status: string; notes: string | null; createdAt: string; createdBy: string | null }[];
}

function formatMoney(minor: string): string {
  const value = Number(minor) / 100;
  return `₹${value.toFixed(2)}`;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "live", label: "🔴 Live Orders" },
  { key: "all", label: "📋 All Orders" },
  { key: "online", label: "🌐 Online / Delivery" },
];

export default function OrdersPage() {
  const { me, loading: authLoading } = useAuthGuard("order.read");
  const router = useRouter();
  const tabParam = typeof router.query.tab === "string" ? router.query.tab : "live";
  const tab: Tab = tabParam === "all" || tabParam === "online" ? tabParam : "live";

  const outlet = me?.outlet ?? null;
  const outletName = outlet?.name || (authLoading ? "Loading..." : "Outlet");
  const outletCode = outlet?.code || "";

  const [orders, setOrders] = useState<OrderSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(businessDateIso);
  const [toDate, setToDate] = useState(businessDateIso);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [liveSubTab, setLiveSubTab] = useState<LiveSubTab>("orders");
  const [tables, setTables] = useState<TableDto[]>([]);

  // All Orders tab: filter bar + pagination + revenue trend
  const [orderTypeFilter, setOrderTypeFilter] = useState("");
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPointDto[]>([]);

  const setTab = (next: Tab) => {
    router.push(`/orders?tab=${next}`, undefined, { shallow: true });
  };

  const fetchOrders = useCallback(() => {
    const params = new URLSearchParams();
    params.set("view", tab);
    if (tab === "all") {
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      if (orderTypeFilter) params.set("orderType", orderTypeFilter);
      if (orderIdSearch.trim()) params.set("orderId", orderIdSearch.trim());
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
    }
    if (tab === "live") {
      params.set("limit", "200");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    setLoading(true);
    authedFetch(`/orders?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout);
        if (!res.ok) throw new Error("HTTP error " + res.status);
        const totalHeader = res.headers.get("X-Total-Count");
        if (totalHeader) setTotalCount(Number(totalHeader));
        return res.json();
      })
      .then((data) => {
        setOrders(data.orders || (Array.isArray(data) ? data : []));
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        setLoadError(err instanceof Error ? err.message : "Failed to load orders");
        setOrders([]);
        setLoading(false);
      });
  }, [tab, fromDate, toDate, orderTypeFilter, orderIdSearch, page]);

  const fetchRevenueTrend = useCallback(() => {
    const params = new URLSearchParams();
    const to = toDate ? new Date(toDate) : new Date();
    const from = fromDate ? new Date(fromDate) : new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
    params.set("fromDate", from.toISOString());
    params.set("toDate", to.toISOString());

    authedFetch(`/reporting/revenue-trend?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRevenueTrend(Array.isArray(data) ? data : []))
      .catch(() => setRevenueTrend([]));
  }, [fromDate, toDate]);

  useEffect(() => {
    if (authLoading || tab !== "live") return;
    authedFetch("/tables")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTables(Array.isArray(data) ? data : []))
      .catch(() => setTables([]));
  }, [authLoading, tab]);

  useEffect(() => {
    if (authLoading) return;
    if (tab === "online") return;
    fetchOrders();
    const interval = setInterval(fetchOrders, 15000);
    return () => clearInterval(interval);
  }, [authLoading, fetchOrders, tab]);

  useEffect(() => {
    if (authLoading || tab !== "all") return;
    fetchRevenueTrend();
  }, [authLoading, tab, fetchRevenueTrend]);

  useEffect(() => {
    setPage(1);
  }, [orderTypeFilter, orderIdSearch, fromDate, toDate]);

  const toggleExpand = (orderId: string) => {
    if (expandedId === orderId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(orderId);
    setDetail(null);
    setDetailLoading(true);
    authedFetch(`/orders/${orderId}`)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json();
      })
      .then((data) => {
        setDetail(data);
        setDetailLoading(false);
      })
      .catch(() => {
        setDetail(null);
        setDetailLoading(false);
      });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading orders...
      </div>
    );
  }

  return (
    <div className="orders-page-root">
      <Head>
        <title>Order Management - PetPooja POS</title>
      </Head>

      <PetPoojaHeader
        outletName={outletName}
        outletCode={outletCode}
        onNewOrder={() => router.push("/")}
      />

      {/* Render Online Aggregators View directly when on online tab */}
      {tab === "online" ? (
        <AggregatorOrdersView />
      ) : (
        <div className="orders-board-content">
          <div className="orders-subnav-row">
            <div className="tab-pill-group">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-btn ${tab === t.key ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button className="btn-refresh" onClick={fetchOrders}>
              ↻ Refresh
            </button>
          </div>

          {tab === "all" && (
            <div className="orders-filter-row">
              <select
                value={orderTypeFilter}
                onChange={(e) => setOrderTypeFilter(e.target.value)}
                aria-label="Filter by order type"
              >
                <option value="">All types</option>
                {ORDER_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {ORDER_TYPE_LABELS[t] || t}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="From date"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="To date"
              />
              <input
                type="search"
                value={orderIdSearch}
                onChange={(e) => setOrderIdSearch(e.target.value)}
                placeholder="Order #"
                aria-label="Search order number"
              />
            </div>
          )}

          {loadError && <div className="error-banner">{loadError}</div>}

          {/* Table List View */}
          <div className="orders-table-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th>Grand Total</th>
                  <th>Date & Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#94a3b8" }}>
                      Loading orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#94a3b8" }}>
                      No orders found in this view.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <React.Fragment key={order.id}>
                      <tr className={expandedId === order.id ? "row-expanded" : ""}>
                        <td>
                          <strong>{order.orderNumber}</strong>
                        </td>
                        <td>
                          <span className="badge-type">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</span>
                        </td>
                        <td>
                          <span className={`badge-status status-${order.status.toLowerCase()}`}>
                            {order.status}
                          </span>
                        </td>
                        <td>{order.itemCount}</td>
                        <td style={{ fontWeight: 700, color: "#16a34a" }}>
                          {formatMoney(order.grandTotalMinor)}
                        </td>
                        <td>{new Date(order.createdAt).toLocaleString()}</td>
                        <td>
                          <button className="btn-details" onClick={() => toggleExpand(order.id)}>
                            {expandedId === order.id ? "Hide Details" : "View Details"}
                          </button>
                        </td>
                      </tr>

                      {expandedId === order.id && (
                        <tr className="details-expand-row">
                          <td colSpan={7}>
                            {detailLoading ? (
                              <div style={{ padding: "12px", color: "#64748b" }}>Loading details...</div>
                            ) : detail ? (
                              <div className="order-details-pane">
                                <div>
                                  <h4 style={{ margin: "0 0 8px 0" }}>Order Items:</h4>
                                  <ul>
                                    {detail.items.map((it) => (
                                      <li key={it.id}>
                                        {it.quantity}x {it.menuItemName} — {formatMoney(it.subtotalMinor)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <h4 style={{ margin: "0 0 8px 0" }}>Payments:</h4>
                                  {detail.payments.length === 0 ? (
                                    <p>No payments recorded.</p>
                                  ) : (
                                    <ul>
                                      {detail.payments.map((p) => (
                                        <li key={p.id}>
                                          {p.method} — {formatMoney(p.amountMinor)} ({p.status})
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div style={{ padding: "12px", color: "#dc2626" }}>Failed to load details.</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {tab === "all" && totalPages > 1 && (
            <div className="orders-pager">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages} ({totalCount} orders)
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .orders-page-root {
          min-height: 100vh;
          background: #f8fafc;
          font-family: inherit;
        }
        .orders-board-content {
          max-width: 1200px;
          margin: 20px auto;
          padding: 0 16px;
        }
        .orders-subnav-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .orders-filter-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .orders-filter-row select,
        .orders-filter-row input {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 0.8125rem;
        }
        .orders-pager {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 12px;
          font-size: 0.8125rem;
          color: #475569;
        }
        .orders-pager button {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
        }
        .orders-pager button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .tab-pill-group {
          display: flex;
          gap: 8px;
        }
        .tab-btn {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 0.8125rem;
          font-weight: 700;
          color: #475569;
          cursor: pointer;
        }
        .tab-btn.active {
          background: #2563eb;
          color: #ffffff;
          border-color: #2563eb;
        }
        .btn-refresh {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          padding: 8px 14px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
        }
        .orders-table-wrapper {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          overflow: hidden;
        }
        .orders-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
        }
        .orders-table th {
          background: #f1f5f9;
          padding: 10px 14px;
          text-align: left;
          font-weight: 800;
          color: #64748b;
          font-size: 0.6875rem;
        }
        .orders-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
        }
        .badge-type {
          background: #e2e8f0;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .badge-status {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .status-active, .status-preparing, .status-ready { background: #dbeafe; color: #1e40af; }
        .status-printed, .status-billing { background: #dcfce7; color: #166534; }
        .status-paid, .status-settled, .status-completed { background: #f1f5f9; color: #334155; }
        .status-cancelled, .status-voided { background: #fee2e2; color: #991b1b; }
        .btn-details {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
        }
        .order-details-pane {
          background: #f8fafc;
          padding: 14px;
          border-radius: 6px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .error-banner {
          background: #fee2e2;
          color: #991b1b;
          padding: 10px;
          border-radius: 6px;
          margin-bottom: 12px;
        }
      `}</style>
    </div>
  );
}
