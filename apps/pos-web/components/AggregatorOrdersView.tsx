import React, { useState, useEffect, useMemo } from "react";
import { authedFetch } from "../lib/auth";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";

interface OnlineOrder {
  id: string;
  orderNumber: string;
  externalOrderId?: string;
  channel: "SWIGGY" | "ZOMATO" | "DIRECT";
  status: "PENDING" | "ACCEPTED" | "FOOD_READY" | "DISPATCHED" | "DELIVERED" | "CANCELLED";
  customerName?: string;
  customerPhone?: string;
  riderName?: string;
  riderPhone?: string;
  grandTotalMinor: number;
  itemCount: number;
  createdAt: string;
  items?: { name: string; quantity: number; priceMinor: number }[];
}

export default function AggregatorOrdersView() {
  const [topTab, setTopTab] = useState<"CURRENT" | "ONLINE" | "ADVANCE">("ONLINE");
  const [statusFilter, setStatusFilter] = useState<OnlineOrder["status"] | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      let endpoint = "/orders/live?kind=online";
      if (topTab === "ADVANCE") {
        endpoint = "/orders/advance";
      } else if (topTab === "CURRENT") {
        endpoint = "/orders/live";
      }

      const res = await authedFetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        const list = data.orders || (Array.isArray(data) ? data : []);
        const scoped =
          topTab === "CURRENT"
            ? list.filter((ord: any) => ord.orderType !== "DINE_IN")
            : list;
        const mapped: OnlineOrder[] = scoped.map((ord: any) => {
          let status: OnlineOrder["status"] = "PENDING";
          if (ord.status === "CONFIRMED" || ord.status === "ACTIVE" || ord.status === "PREPARING" || ord.status === "IN_PREPARATION" || ord.status === "KOT_CREATED") {
            status = "ACCEPTED";
          } else if (ord.status === "READY" || ord.status === "FOOD_READY") {
            status = "FOOD_READY";
          } else if (ord.status === "DISPATCHED" || ord.status === "OUT_FOR_DELIVERY" || ord.status === "HANDED_OVER" || ord.status === "SERVED") {
            status = "DISPATCHED";
          } else if (ord.status === "DELIVERED" || ord.status === "COMPLETED") {
            status = "DELIVERED";
          } else if (ord.status === "CANCELLED" || ord.status === "VOIDED") {
            status = "CANCELLED";
          }

          const orderNum = String(ord.orderNumber || "");
          const channel: OnlineOrder["channel"] =
            ord.channel === "SWIGGY" || /^SWIGGY-/i.test(orderNum)
              ? "SWIGGY"
              : ord.channel === "ZOMATO" || /^ZOMATO-/i.test(orderNum)
                ? "ZOMATO"
                : "DIRECT";

          return {
            id: ord.id,
            orderNumber: ord.orderNumber,
            externalOrderId: ord.externalOrderId || ord.orderNumber,
            channel,
            status,
            customerName: ord.customerName || ord.customer?.name || "Guest",
            customerPhone: ord.customerPhone || ord.customer?.phone || "",
            riderName: ord.riderName || "",
            riderPhone: ord.riderPhone || "",
            grandTotalMinor: Number(ord.grandTotalMinor ?? ord.grandTotal ?? 0),
            itemCount: ord.itemCount || (ord.orderItems?.length || ord.items?.length || 1),
            createdAt: ord.createdAt || new Date().toISOString(),
            items: (ord.orderItems || ord.items || []).map((it: any) => ({
              name: it.item_name || it.menuItemName || it.name || it.menuItem?.name || "Item",
              quantity: Number(it.quantity || 1),
              priceMinor: Number(it.unitPriceMinor || it.unitPrice || it.subtotalMinor || it.subtotal || 0),
            })),
          };
        });
        setOrders(mapped);
        // #region agent log
        fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
          body: JSON.stringify({
            sessionId: "9c675b",
            hypothesisId: "AG1",
            location: "AggregatorOrdersView.tsx:fetchOrders",
            message: "mapped online/current orders",
            data: {
              topTab,
              count: mapped.length,
              sample: mapped.slice(0, 5).map((o) => ({
                n: o.orderNumber,
                channel: o.channel,
                status: o.status,
                customer: o.customerName,
                grand: o.grandTotalMinor,
              })),
            },
            timestamp: Date.now(),
            runId: "agg-pre",
          }),
        }).catch(() => {});
        // #endregion
      }
    } catch (e) {
      console.error("Failed to fetch orders:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [topTab]);

  useKapmetaSocket(
    (payload) => {
      if (
        payload.topic === "kot.created" ||
        payload.topic === "kot.status_updated" ||
        payload.topic === "order.status_updated" ||
        payload.topic === "order.created" ||
        payload.topic === "finance.order_settled"
      ) {
        fetchOrders();
      }
    },
    true,
    "aggregator-orders"
  );

  const handleUpdateStatus = async (orderId: string, nextStatus: OnlineOrder["status"]) => {
    setUpdatingId(orderId);
    try {
      let apiStatus = "CONFIRMED";
      if (nextStatus === "FOOD_READY") apiStatus = "READY";
      if (nextStatus === "DISPATCHED") apiStatus = "HANDED_OVER";
      if (nextStatus === "DELIVERED") apiStatus = "COMPLETED";
      if (nextStatus === "CANCELLED") apiStatus = "CANCELLED";

      const res = await authedFetch(`/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: apiStatus, status: apiStatus }),
      });
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"9c675b"},body:JSON.stringify({sessionId:"9c675b",hypothesisId:"AGG1",location:"AggregatorOrdersView.tsx:handleUpdateStatus",message:"aggregator status patch",data:{orderId,nextStatus,apiStatus,ok:res.ok,http:res.status},timestamp:Date.now(),runId:"agg-kot-post"})}).catch(()=>{});
      // #endregion
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSettleCash = async (orderId: string, amountMinor: number) => {
    setUpdatingId(orderId);
    try {
      const settleRes = await authedFetch(`/orders/${orderId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "CASH", amountPaidMinor: amountMinor }),
      });
      // #region agent log
      fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
        body: JSON.stringify({
          sessionId: "9c675b",
          hypothesisId: "D",
          location: "AggregatorOrdersView.tsx:handleSettleCash",
          message: "CURRENT tab cash settle",
          data: { orderId, amountMinor, ok: settleRes.ok, status: settleRes.status },
          timestamp: Date.now(),
          runId: "modes-lifecycle",
        }),
      }).catch(() => {});
      // #endregion
      if (!settleRes.ok) {
        const err = await settleRes.json().catch(() => ({} as { error?: string }));
        alert(err.error || `Settle failed (${settleRes.status})`);
        return;
      }
      await fetchOrders();
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleFireAdvance = async (orderId: string) => {
    setUpdatingId(orderId);
    try {
      const res = await authedFetch(`/orders/${orderId}/fire-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        alert("Advance order successfully fired to Kitchen KDS!");
        fetchOrders();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkAllFoodReady = async () => {
    const accepted = orders.filter((o) => o.status === "ACCEPTED" || o.status === "PENDING");
    for (const ord of accepted) {
      await handleUpdateStatus(ord.id, "FOOD_READY");
    }
    alert(`Marked ${accepted.length} orders as Food Ready!`);
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((ord) => {
      const matchStatus = statusFilter === "ALL" || ord.status === statusFilter;
      const matchSearch =
        !search ||
        ord.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
        (ord.externalOrderId && ord.externalOrderId.toLowerCase().includes(search.toLowerCase())) ||
        (ord.customerName && ord.customerName.toLowerCase().includes(search.toLowerCase()));
      return matchStatus && matchSearch;
    });
  }, [orders, statusFilter, search]);

  return (
    <div className="aggregator-container">
      {/* Top Main Tabs */}
      <div className="aggregator-top-tabs">
        <button
          className={`top-tab ${topTab === "CURRENT" ? "active" : ""}`}
          onClick={() => setTopTab("CURRENT")}
        >
          Current Order
        </button>
        <button
          className={`top-tab ${topTab === "ONLINE" ? "active" : ""}`}
          onClick={() => setTopTab("ONLINE")}
        >
          Online Order
        </button>
        <button
          className={`top-tab ${topTab === "ADVANCE" ? "active" : ""}`}
          onClick={() => setTopTab("ADVANCE")}
        >
          Advance Order
        </button>
      </div>

      {/* Subheader Toolbar: Search + Status Pipeline Filters + Food Ready CTA */}
      <div className="aggregator-subbar">
        <div className="search-box">
          <span>🔍</span>
          <input
            type="text"
            placeholder="Search order ID, rider, or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* 6-Stage Filter Pipeline */}
        <div className="status-pipeline-filters">
          <button
            className={`filter-chip ${statusFilter === "ALL" ? "active" : ""}`}
            onClick={() => setStatusFilter("ALL")}
          >
            All ({orders.length})
          </button>
          <button
            className={`filter-chip ${statusFilter === "PENDING" ? "active" : ""}`}
            onClick={() => setStatusFilter("PENDING")}
          >
            ● Pending ({orders.filter((o) => o.status === "PENDING").length})
          </button>
          <button
            className={`filter-chip ${statusFilter === "ACCEPTED" ? "active" : ""}`}
            onClick={() => setStatusFilter("ACCEPTED")}
          >
            ● Accepted ({orders.filter((o) => o.status === "ACCEPTED").length})
          </button>
          <button
            className={`filter-chip ${statusFilter === "FOOD_READY" ? "active" : ""}`}
            onClick={() => setStatusFilter("FOOD_READY")}
          >
            ● Food Is Ready ({orders.filter((o) => o.status === "FOOD_READY").length})
          </button>
          <button
            className={`filter-chip ${statusFilter === "DISPATCHED" ? "active" : ""}`}
            onClick={() => setStatusFilter("DISPATCHED")}
          >
            ● Dispatched ({orders.filter((o) => o.status === "DISPATCHED").length})
          </button>
          <button
            className={`filter-chip ${statusFilter === "DELIVERED" ? "active" : ""}`}
            onClick={() => setStatusFilter("DELIVERED")}
          >
            ● Delivered / Handover ({orders.filter((o) => o.status === "DELIVERED").length})
          </button>
          <button
            className={`filter-chip ${statusFilter === "CANCELLED" ? "active" : ""}`}
            onClick={() => setStatusFilter("CANCELLED")}
          >
            ● Cancelled ({orders.filter((o) => o.status === "CANCELLED").length})
          </button>
        </div>

        {/* Global Food Ready Button */}
        <button
          type="button"
          className="btn-food-ready-header"
          onClick={handleMarkAllFoodReady}
        >
          Food Ready
        </button>
      </div>

      {/* Orders List Table / Feed */}
      <div className="orders-feed-scroll">
        {loading && orders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px", color: "#94a3b8" }}>
            Connecting to Swiggy & Zomato aggregator feeds...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px", color: "#94a3b8" }}>
            No online orders found in this view.
          </div>
        ) : (
          <div className="online-orders-table">
            <div className="table-header-row">
              <span>CHANNEL / ORDER ID</span>
              <span>CUSTOMER / RIDER</span>
              <span>TIME ELAPSED</span>
              <span>AMOUNT</span>
              <span>STATUS</span>
              <span>ACTIONS</span>
            </div>

            {filteredOrders.map((ord) => {
              const elapsedMins = Math.max(1, Math.floor((Date.now() - new Date(ord.createdAt).getTime()) / 60000));
              return (
                <div key={ord.id} className="table-data-row">
                  {/* Channel & ID */}
                  <div className="col-channel">
                    <span className={`channel-badge ${ord.channel.toLowerCase()}`}>
                      {ord.channel === "SWIGGY" ? "Swiggy" : ord.channel === "ZOMATO" ? "Zomato" : "Direct"}
                    </span>
                    <div>
                      <div className="order-id-text">#{ord.externalOrderId || ord.orderNumber}</div>
                      <div className="item-count-sub">{ord.itemCount} items</div>
                    </div>
                  </div>

                  {/* Customer / Rider */}
                  <div className="col-cust-rider">
                    <div className="cust-name">{ord.customerName}</div>
                    <div className="rider-info">Rider: {ord.riderName}</div>
                  </div>

                  {/* Elapsed Time */}
                  <div className="col-time">
                    <span className="time-badge">{elapsedMins} min</span>
                  </div>

                  {/* Amount */}
                  <div className="col-amount">
                    ₹{(ord.grandTotalMinor / 100).toFixed(2)}
                  </div>

                  {/* Status */}
                  <div className="col-status">
                    <span className={`status-tag status-${ord.status.toLowerCase()}`}>
                      {ord.status.replace("_", " ")}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="col-actions">
                    <button
                      type="button"
                      className="btn-action-view"
                      onClick={() => setSelectedOrder(ord)}
                    >
                      View Details
                    </button>

                    {topTab === "ADVANCE" && ord.status === "PENDING" && (
                      <button
                        type="button"
                        className="btn-action-ready"
                        style={{ background: "#ea580c" }}
                        disabled={updatingId === ord.id}
                        onClick={() => handleFireAdvance(ord.id)}
                      >
                        🔥 Fire to KDS
                      </button>
                    )}

                    {ord.status === "PENDING" && topTab !== "ADVANCE" && (
                      <button
                        type="button"
                        className="btn-action-accept"
                        disabled={updatingId === ord.id}
                        onClick={() => handleUpdateStatus(ord.id, "ACCEPTED")}
                      >
                        Accept Order
                      </button>
                    )}

                    {ord.status === "ACCEPTED" && (
                      <button
                        type="button"
                        className="btn-action-ready"
                        disabled={updatingId === ord.id}
                        onClick={() => handleUpdateStatus(ord.id, "FOOD_READY")}
                      >
                        Mark Ready
                      </button>
                    )}

                    {ord.status === "FOOD_READY" && (
                      <button
                        type="button"
                        className="btn-action-dispatch"
                        disabled={updatingId === ord.id}
                        onClick={() => handleUpdateStatus(ord.id, "DISPATCHED")}
                      >
                        Dispatch / Handover
                      </button>
                    )}

                    {topTab !== "ADVANCE" && (ord.status === "DISPATCHED" || ord.status === "FOOD_READY") && (
                      <button
                        type="button"
                        className="btn-action-dispatch"
                        style={{ background: "#15803d" }}
                        disabled={updatingId === ord.id}
                        onClick={() => handleSettleCash(ord.id, ord.grandTotalMinor)}
                      >
                        Settle cash
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-action-chat"
                      onClick={() => alert(`Connecting to ${ord.channel} merchant support chat...`)}
                    >
                      Chat Support
                    </button>

                    <button
                      type="button"
                      className="btn-action-call"
                      onClick={() => alert(`Dialing customer ${ord.customerPhone}...`)}
                    >
                      Call Customer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="detail-modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="detail-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={`channel-badge ${selectedOrder.channel.toLowerCase()}`}>
                  {selectedOrder.channel}
                </span>
                <h3 style={{ margin: 0 }}>Order #{selectedOrder.externalOrderId}</h3>
              </div>
              <button className="close-btn" onClick={() => setSelectedOrder(null)}>✕</button>
            </div>

            <div style={{ marginTop: "14px", fontSize: "0.875rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>Customer: <strong>{selectedOrder.customerName}</strong> ({selectedOrder.customerPhone})</div>
              <div>Rider: <strong>{selectedOrder.riderName}</strong></div>
              <div>Status: <strong>{selectedOrder.status}</strong></div>
              <div>Time: <strong>{new Date(selectedOrder.createdAt).toLocaleTimeString()}</strong></div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: "0.875rem" }}>Ordered Items:</h4>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", maxHeight: "180px", overflowY: "auto" }}>
                {selectedOrder.items && selectedOrder.items.length > 0 ? (
                  selectedOrder.items.map((it, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "0.8125rem" }}>
                      <span>{it.quantity}x {it.name}</span>
                      <span>₹{(it.priceMinor / 100).toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8" }}>Standard Online Meal Package</div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "14px", fontWeight: 800 }}>
              <span>Total Invoice Amount:</span>
              <span style={{ color: "#16a34a", fontSize: "1.1rem" }}>
                ₹{(selectedOrder.grandTotalMinor / 100).toFixed(2)}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
              <button className="btn-close-modal" onClick={() => setSelectedOrder(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .aggregator-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 48px);
          background: #f8fafc;
          font-family: inherit;
        }

        .aggregator-top-tabs {
          display: flex;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 16px;
          gap: 8px;
        }
        .top-tab {
          background: transparent;
          border: none;
          padding: 10px 16px;
          font-size: 0.8125rem;
          font-weight: 700;
          color: #64748b;
          cursor: pointer;
        }
        .top-tab.active {
          color: #dc2626;
          box-shadow: inset 0 -2px 0 #dc2626;
        }

        .aggregator-subbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          gap: 12px;
          flex-wrap: wrap;
        }
        .search-box {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          padding: 4px 10px;
          min-width: 200px;
        }
        .search-box input {
          border: none;
          background: transparent;
          outline: none;
          font-size: 0.75rem;
          width: 100%;
        }

        .status-pipeline-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .filter-chip {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
          color: #475569;
          cursor: pointer;
        }
        .filter-chip.active {
          background: #e2e8f0;
          color: #0f172a;
          font-weight: 700;
        }

        .btn-food-ready-header {
          background: #e11d48;
          color: #ffffff;
          border: none;
          padding: 6px 14px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }

        .orders-feed-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }

        .online-orders-table {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          overflow: hidden;
        }
        .table-header-row {
          display: grid;
          grid-template-columns: 180px 180px 100px 100px 130px 1fr;
          padding: 10px 14px;
          background: #f1f5f9;
          font-size: 0.6875rem;
          font-weight: 800;
          color: #64748b;
          border-bottom: 1px solid #e2e8f0;
        }
        .table-data-row {
          display: grid;
          grid-template-columns: 180px 180px 100px 100px 130px 1fr;
          align-items: center;
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 0.8125rem;
        }
        .table-data-row:hover {
          background: #f8fafc;
        }

        .col-channel {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .channel-badge {
          font-size: 0.625rem;
          font-weight: 900;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .channel-badge.swiggy {
          background: #fff4e8;
          color: #fc8019;
          border: 1px solid #fed7aa;
        }
        .channel-badge.zomato {
          background: #fdeced;
          color: #e23744;
          border: 1px solid #fecaca;
        }
        .channel-badge.direct {
          background: #eff6ff;
          color: #2563eb;
          border: 1px solid #bfdbfe;
        }

        .order-id-text {
          font-weight: 700;
          color: #0f172a;
        }
        .item-count-sub {
          font-size: 0.6875rem;
          color: #64748b;
        }

        .cust-name {
          font-weight: 600;
        }
        .rider-info {
          font-size: 0.6875rem;
          color: #64748b;
        }

        .time-badge {
          font-size: 0.6875rem;
          font-weight: 600;
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .col-amount {
          font-weight: 700;
          color: #16a34a;
        }

        .status-tag {
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 4px;
        }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-accepted { background: #dbeafe; color: #1e40af; }
        .status-food_ready { background: #dcfce7; color: #166534; }
        .status-dispatched { background: #f3e8ff; color: #6b21a8; }
        .status-delivered { background: #e2e8f0; color: #334155; }
        .status-cancelled { background: #fee2e2; color: #991b1b; }

        .col-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .btn-action-view, .btn-action-chat, .btn-action-call {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-action-accept {
          background: #2563eb;
          color: #fff;
          border: none;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-action-ready {
          background: #16a34a;
          color: #fff;
          border: none;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-action-dispatch {
          background: #7e22ce;
          color: #fff;
          border: none;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          cursor: pointer;
        }

        /* Modal */
        .detail-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.5);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .detail-modal-card {
          background: #ffffff;
          padding: 24px;
          border-radius: 12px;
          width: 90%;
          max-width: 520px;
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .close-btn {
          background: transparent;
          border: none;
          font-size: 1.1rem;
          cursor: pointer;
        }
        .btn-close-modal {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
