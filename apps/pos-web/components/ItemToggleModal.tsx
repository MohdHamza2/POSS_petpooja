import React, { useState, useEffect } from "react";
import { authedFetch } from "../lib/auth";

interface ItemToggleModalProps {
  onClose: () => void;
}

interface ItemState {
  id: string;
  name: string;
  categoryName: string;
  priceMinor: number;
  isStocked: boolean;
  stockQty: number;
  isVeg: boolean;
}

export default function ItemToggleModal({ onClose }: ItemToggleModalProps) {
  const [items, setItems] = useState<ItemState[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    loadAvailability();
  }, []);

  const loadAvailability = async () => {
    try {
      setLoading(true);
      const res = await authedFetch("/menu/availability");
      if (res.ok) {
        const data = await res.json();
        const mapped = (data || []).map((it: any) => ({
          id: it.id,
          name: it.name,
          categoryName: it.categoryName || it.category?.name || "General",
          priceMinor: Number(it.priceMinor || 0),
          isStocked: typeof it.isStocked === "boolean" ? it.isStocked : (it.availability ? it.availability.isStocked : true),
          stockQty: typeof it.stockQty === "number" ? it.stockQty : (it.availability ? it.availability.stockQty : 100),
          isVeg: it.isVeg ?? true,
        }));
        setItems(mapped);
        // #region agent log
        fetch("http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9c675b" },
          body: JSON.stringify({
            sessionId: "9c675b",
            hypothesisId: "86B",
            location: "ItemToggleModal.tsx:loadAvailability",
            message: "86 modal mapped stock flags",
            data: { count: mapped.length, offCount: mapped.filter((i: ItemState) => !i.isStocked).length },
            timestamp: Date.now(),
            runId: "pause-86",
          }),
        }).catch(() => {});
        // #endregion
      }
    } catch (err) {
      console.error("Failed to load item availability", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (item: ItemState) => {
    setTogglingId(item.id);
    const nextStocked = !item.isStocked;
    try {
      const res = await authedFetch(`/menu/items/${item.id}/availability`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isStocked: nextStocked,
          stockQty: nextStocked ? 100 : 0,
          expectedVersion: 1,
        }),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, isStocked: nextStocked, stockQty: nextStocked ? 100 : 0 } : it
          )
        );
      }
    } catch (err) {
      console.error("Failed to toggle item stock", err);
    } finally {
      setTogglingId(null);
    }
  };

  const filteredItems = items.filter((it) =>
    it.name.toLowerCase().includes(search.toLowerCase()) ||
    it.categoryName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="item-toggle-backdrop" onClick={onClose}>
      <div className="item-toggle-card" onClick={(e) => e.stopPropagation()}>
        <div className="item-toggle-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.25rem", color: "#dc2626" }}>⊘</span>
            <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>Item On/Off (86 Stock Control)</h3>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <p style={{ margin: "6px 0 12px 0", fontSize: "0.8125rem", color: "#64748b" }}>
          Toggle items On or Off in real-time across POS, Captain tablets, and Online Delivery channels.
        </p>

        <div style={{ marginBottom: "12px" }}>
          <input
            type="text"
            className="toggle-search-input"
            placeholder="Search menu item or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="items-list-scroll">
          {loading ? (
            <div style={{ textAlign: "center", padding: "24px", color: "#94a3b8" }}>Loading catalog...</div>
          ) : filteredItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px", color: "#94a3b8" }}>No items found.</div>
          ) : (
            filteredItems.map((item) => (
              <div key={item.id} className="item-toggle-row">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className={`veg-tag ${item.isVeg ? "veg" : "non-veg"}`}>●</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem", color: item.isStocked ? "#0f172a" : "#94a3b8" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                      {item.categoryName} • ₹{(item.priceMinor / 100).toFixed(2)}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className={`status-pill ${item.isStocked ? "in-stock" : "out-of-stock"}`}>
                    {item.isStocked ? "IN STOCK" : "86'D / OFF"}
                  </span>
                  <button
                    type="button"
                    disabled={togglingId === item.id}
                    className={`toggle-switch-btn ${item.isStocked ? "is-on" : "is-off"}`}
                    onClick={() => handleToggle(item)}
                  >
                    {togglingId === item.id ? "..." : item.isStocked ? "Turn OFF" : "Turn ON"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .item-toggle-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.5);
          z-index: 150;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .item-toggle-card {
          background: #ffffff;
          padding: 20px;
          border-radius: 12px;
          width: 90%;
          max-width: 560px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
          max-height: 85vh;
          display: flex;
          flex-direction: column;
        }
        .item-toggle-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .close-btn {
          background: transparent;
          border: none;
          font-size: 1.1rem;
          cursor: pointer;
          color: #64748b;
        }
        .toggle-search-input {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.875rem;
          outline: none;
        }
        .items-list-scroll {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-right: 4px;
        }
        .item-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: #f8fafc;
        }
        .veg-tag {
          font-size: 0.875rem;
        }
        .veg-tag.veg { color: #16a34a; }
        .veg-tag.non-veg { color: #dc2626; }
        .status-pill {
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .status-pill.in-stock {
          background: #dcfce7;
          color: #15803d;
        }
        .status-pill.out-of-stock {
          background: #fee2e2;
          color: #b91c1c;
        }
        .toggle-switch-btn {
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }
        .toggle-switch-btn.is-on {
          background: #ef4444;
          color: #ffffff;
        }
        .toggle-switch-btn.is-off {
          background: #22c55e;
          color: #ffffff;
        }
      `}</style>
    </div>
  );
}
