import React, { useState, useEffect } from "react";
import { authedFetch } from "../lib/auth";

export interface HeldOrder {
  id: string;
  tableNumber: string;
  diningTableId?: string | null;
  orderType: string;
  itemCount: number;
  totalMinor: number;
  heldAt: string;
  items?: Array<{ id: string; menuItemId: string; name: string; quantity: number; unitPriceMinor: number; notes?: string | null }>;
}

interface HoldOrdersDrawerProps {
  onClose: () => void;
  onResumeOrder?: (order: HeldOrder) => void;
}

export default function HoldOrdersDrawer({ onClose, onResumeOrder }: HoldOrdersDrawerProps) {
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHeld = async () => {
    try {
      const res = await authedFetch("/orders/held");
      if (!res.ok) {
        setHeldOrders([]);
        return;
      }
      const data = await res.json();
      setHeldOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setHeldOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHeld();
  }, []);

  const handleResume = (order: HeldOrder) => {
    if (onResumeOrder) onResumeOrder(order);
    onClose();
  };

  const handleDiscard = async (id: string) => {
    try {
      await authedFetch(`/orders/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reasonCode: "HELD_DISCARDED" }),
      });
    } catch (e) {
      console.error(e);
    }
    setHeldOrders((prev) => prev.filter((o) => o.id !== id));
  };

  return (
    <div className="hold-drawer-backdrop" onClick={onClose}>
      <div className="hold-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.2rem", color: "#f59e0b" }}>⏸</span>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Held Carts & Parked Orders</h3>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="held-orders-list">
          {loading ? (
            <div className="empty-hold">Loading parked orders…</div>
          ) : heldOrders.length === 0 ? (
            <div className="empty-hold">No active held carts. Use the Hold button during billing to park an order.</div>
          ) : (
            heldOrders.map((ord) => (
              <div key={ord.id} className="held-order-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span className="order-tag">{ord.orderType}</span>
                    <strong style={{ marginLeft: "8px", fontSize: "0.95rem" }}>
                      {ord.tableNumber ? `Table ${ord.tableNumber}` : "Direct Cart"}
                    </strong>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "4px" }}>
                      {ord.itemCount} items • Held at {new Date(ord.heldAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <div style={{ fontSize: "1rem", fontWeight: 700, color: "#16a34a" }}>
                    ₹{(ord.totalMinor / 100).toFixed(2)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                  <button
                    type="button"
                    className="resume-btn"
                    onClick={() => handleResume(ord)}
                  >
                    Resume Order
                  </button>
                  <button
                    type="button"
                    className="discard-btn"
                    onClick={() => handleDiscard(ord.id)}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .hold-drawer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.4);
          z-index: 150;
          display: flex;
          justify-content: flex-end;
        }
        .hold-drawer-panel {
          width: 360px;
          height: 100%;
          background: #ffffff;
          box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
          display: flex;
          flex-direction: column;
          animation: slideFromRight 0.2s ease-out;
        }
        .drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid #e2e8f0;
        }
        .close-btn {
          background: transparent;
          border: none;
          font-size: 1.1rem;
          cursor: pointer;
          color: #64748b;
        }
        .held-orders-list {
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex: 1;
        }
        .empty-hold {
          color: #94a3b8;
          text-align: center;
          padding: 32px 0;
          font-size: 0.875rem;
        }
        .held-order-card {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 12px;
          background: #f8fafc;
        }
        .order-tag {
          font-size: 0.6875rem;
          font-weight: 700;
          background: #e2e8f0;
          color: #334155;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .resume-btn {
          flex: 1;
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.8125rem;
          cursor: pointer;
        }
        .discard-btn {
          background: #fee2e2;
          color: #b91c1c;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.8125rem;
          cursor: pointer;
        }
        @keyframes slideFromRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
