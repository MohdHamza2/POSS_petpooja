import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { authedFetch, logout } from "../lib/auth";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";
import QuickSearchModal from "./QuickSearchModal";
import ItemToggleModal from "./ItemToggleModal";
import HoldOrdersDrawer from "./HoldOrdersDrawer";

interface PetPoojaHeaderProps {
  outletName?: string;
  outletCode?: string;
  onNewOrder?: () => void;
  activeMode?: "DINE_IN" | "DELIVERY" | "PICKUP";
  onModeChange?: (mode: "DINE_IN" | "DELIVERY" | "PICKUP") => void;
  heldOrdersCount?: number;
  onOpenHoldDrawer?: () => void;
}

export default function PetPoojaHeader({
  outletName = "Outlet",
  outletCode = "",
  onNewOrder,
  activeMode,
  onModeChange,
  heldOrdersCount = 0,
  onOpenHoldDrawer,
}: PetPoojaHeaderProps) {
  const router = useRouter();
  const [searchModalType, setSearchModalType] = useState<"BILL" | "KOT" | null>(null);
  const [isItemToggleOpen, setIsItemToggleOpen] = useState(false);
  const [isHoldOpen, setIsHoldOpen] = useState(false);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [isStoreOnline, setIsStoreOnline] = useState(true);
  const [dineInActive, setDineInActive] = useState(true);
  const [deliveryActive, setDeliveryActive] = useState(true);
  const [takeawayActive, setTakeawayActive] = useState(true);
  const [liveViewActive, setLiveViewActive] = useState(true);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showMenuDrawer, setShowMenuDrawer] = useState(false);

  const [notifications, setNotifications] = useState<Array<{
    id: string;
    title: string;
    message: string;
    type: "WARNING" | "INFO" | "ORDER" | "FINANCE";
    time: string;
    isRead: boolean;
  }>>([]);

  useEffect(() => {
    authedFetch("/notifications")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: any[]) => {
        // Notifications are DB-driven only. The list always reflects what the
        // API returns (an empty array clears the badge) — never a hardcoded
        // demo seed, per the no-hardcode-data rule.
        setNotifications(
          (Array.isArray(data) ? data : []).map((n) => ({
            id: n.id,
            title: n.title || "Alert",
            message: n.message || "",
            type: (n.type as any) || "INFO",
            time: new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            isRead: Boolean(n.isRead),
          }))
        );
      })
      .catch(() => {});

    authedFetch("/settings/store-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.isOnline === "boolean") {
          setIsStoreOnline(data.isOnline);
        }
        if (data && typeof data.dineInActive === "boolean") setDineInActive(data.dineInActive);
        if (data && typeof data.deliveryActive === "boolean") setDeliveryActive(data.deliveryActive);
        if (data && typeof data.pickupActive === "boolean") setTakeawayActive(data.pickupActive);
      })
      .catch(() => {});
  }, []);

  useKapmetaSocket(
    (payload) => {
      if (payload.topic !== "outlet.store_status_updated") return;
      const d = payload.data || {};
      if (typeof d.isOnline === "boolean") setIsStoreOnline(d.isOnline);
      if (typeof d.dineInActive === "boolean") setDineInActive(d.dineInActive);
      if (typeof d.deliveryActive === "boolean") setDeliveryActive(d.deliveryActive);
      if (typeof d.pickupActive === "boolean") setTakeawayActive(d.pickupActive);
    },
    true,
    "pos-header"
  );

  const unreadAlertsCount = notifications.filter((n) => !n.isRead).length;

  const markAllAlertsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    authedFetch("/notifications/read-all", { method: "POST" }).catch(() => {});
  };

  const persistChannelFlag = async (
    flag: "dineInActive" | "deliveryActive" | "pickupActive",
    next: boolean,
    revert: () => void,
  ) => {
    try {
      const res = await authedFetch("/settings/store-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [flag]: next }),
      });
      if (!res.ok) revert();
    } catch (e) {
      console.error(e);
      revert();
    }
  };

  const handleToggleStore = async () => {
    const next = !isStoreOnline;
    setIsStoreOnline(next);
    try {
      await authedFetch("/settings/store-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isOnline: next }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const dismissAlert = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <>
      <header className="petpooja-top-header">
        {/* Left branding & Outlet title */}
        <div className="petpooja-header-left">
          <button
            type="button"
            className="petpooja-hamburger-btn"
            onClick={() => setShowMenuDrawer(!showMenuDrawer)}
            title="Navigation Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="petpooja-logo-badge">
            <span className="logo-text">POSS</span>
          </div>

          <div className="petpooja-outlet-title">
            <span className="outlet-name-bold">{outletName} ({outletCode})</span>
            <span className="outlet-subtitle"> - The Finest Restaurant Management Platform</span>
          </div>
        </div>

        {/* Center Actions: New Order & Quick Search */}
        <div className="petpooja-header-center">
          <button
            type="button"
            className="petpooja-new-order-btn"
            onClick={() => {
              if (onNewOrder) {
                onNewOrder();
              } else {
                router.push("/");
              }
            }}
          >
            New Order
          </button>

          <div className="petpooja-search-box" onClick={() => setSearchModalType("BILL")}>
            <span className="search-icon">🔍</span>
            <span className="search-label">Q Bill No</span>
          </div>

          <div className="petpooja-search-box" onClick={() => setSearchModalType("KOT")}>
            <span className="search-icon">🔍</span>
            <span className="search-label">Q KOT No</span>
          </div>
        </div>

        {/* Right Utility Icons & Actions */}
        <div className="petpooja-header-right">
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setIsItemToggleOpen(true)}
            title="Item On/Off (86 Stock Toggle)"
          >
            <span className="icon-glyph">⊘</span>
            <span className="icon-caption">Item On/Off</span>
          </button>

          <button
            type="button"
            className={`header-icon-btn ${isStoreOnline ? "is-active" : "is-offline"}`}
            onClick={() => setShowStoreModal(true)}
            title="Store Status & Channel Control"
          >
            <span className="icon-glyph">{isStoreOnline ? "🏪" : "🛑"}</span>
            <span className="icon-caption">Store {isStoreOnline ? "(Open)" : "(Paused)"}</span>
          </button>

          <button
            type="button"
            className={`header-icon-btn ${liveViewActive ? "is-live" : ""}`}
            onClick={() => setLiveViewActive(!liveViewActive)}
            title="Live View KDS & Floor Sync"
          >
            <span className="icon-glyph">📡</span>
            <span className="icon-caption">Live View</span>
          </button>

          <Link href="/orders?tab=live" className="header-icon-btn" title="Orders Manager">
            <span className="icon-glyph">📋</span>
            <span className="icon-caption">Orders</span>
          </Link>

          <Link href="/orders?tab=all" className="header-icon-btn" title="Recent Transactions">
            <span className="icon-glyph">🕒</span>
            <span className="icon-caption">Recent</span>
          </Link>

          <button
            type="button"
            className="header-icon-btn"
            onClick={() => {
              if (onOpenHoldDrawer) onOpenHoldDrawer();
              else setIsHoldOpen(true);
            }}
            title="Held Orders / Parked Carts"
          >
            <span className="icon-glyph">⏸</span>
            <span className="icon-caption">Hold {heldOrdersCount > 0 ? `(${heldOrdersCount})` : ""}</span>
          </button>

          <button
            type="button"
            className="header-icon-btn alert-btn"
            onClick={() => setShowAlertsModal(true)}
            title="Live Operational Alerts"
          >
            <span className="icon-glyph">🔔</span>
            {unreadAlertsCount > 0 && <span className="alert-badge">{unreadAlertsCount}</span>}
            <span className="icon-caption">Alerts</span>
          </button>

          <Link href="/channel-availability" className="header-icon-btn" title="Zomato / Swiggy Help & Status">
            <span className="icon-glyph">🛵</span>
            <span className="icon-caption">Zomato Help</span>
          </Link>

          <button
            type="button"
            className="header-icon-btn"
            onClick={() => {
              if (confirm("Are you sure you want to log out of PetPooja POS?")) {
                logout().catch(() => {});
              }
            }}
            title="Log Out"
          >
            <span className="icon-glyph">🚪</span>
            <span className="icon-caption">Logout</span>
          </button>

          <button
            type="button"
            className="header-support-pill"
            onClick={() => setShowSupportModal(true)}
          >
            <span className="support-title">Need Help?</span>
            <span className="support-phone">{outletName}</span>
          </button>
        </div>
      </header>

      {/* Slide-out Global Navigation Drawer */}
      {showMenuDrawer && (
        <div className="petpooja-drawer-backdrop" onClick={() => setShowMenuDrawer(false)}>
          <div className="petpooja-side-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-brand">
                <span className="logo-text">POSS</span>
                <h3>PetPooja POS</h3>
              </div>
              <button className="close-btn" onClick={() => setShowMenuDrawer(false)}>✕</button>
            </div>
            <div className="drawer-nav-list">
              <Link href="/" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🛒 <span>POS Register (Order Taking)</span>
              </Link>
              <Link href="/table-management" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🪑 <span>Table View / Floor Plan</span>
              </Link>
              <Link href="/waiter" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🏃 <span>PetPooja Captain (Tablet / Mobile)</span>
              </Link>
              <Link href="/orders?tab=live" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🔴 <span>Live Orders</span>
              </Link>
              <Link href="/orders?tab=online" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🌐 <span>Online Orders (Swiggy / Zomato)</span>
              </Link>
              <Link href="/kitchen" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🍳 <span>Kitchen Display System (KDS)</span>
              </Link>
              <Link href="/inventory" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                📦 <span>Stock & 86 Item Control</span>
              </Link>
              <Link href="/menu" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🍽️ <span>Menu Management</span>
              </Link>
              <Link href="/channel-availability" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                📡 <span>Aggregator Menu Status</span>
              </Link>
              <Link href="/admin" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                📊 <span>Sales Analytics & Reports</span>
              </Link>
              <Link href="/finance" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                💰 <span>Finance & Z-Report</span>
              </Link>
              <Link href="/user-management" className="drawer-item" onClick={() => setShowMenuDrawer(false)}>
                🧑‍💼 <span>Staff & Role Access</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Search Modal for Bill No / KOT No */}
      {searchModalType && (
        <QuickSearchModal
          type={searchModalType}
          onClose={() => setSearchModalType(null)}
        />
      )}

      {/* Item 86 On/Off Toggle Modal */}
      {isItemToggleOpen && (
        <ItemToggleModal onClose={() => setIsItemToggleOpen(false)} />
      )}

      {/* Hold Orders Drawer */}
      {isHoldOpen && (
        <HoldOrdersDrawer
          onClose={() => setIsHoldOpen(false)}
          onResumeOrder={(order) => {
            setIsHoldOpen(false);
            const q = new URLSearchParams();
            if (order.tableNumber) q.set("table", order.tableNumber);
            if (order.diningTableId) q.set("tableId", order.diningTableId);
            q.set("resumeHold", order.id);
            router.push(`/?${q.toString()}`);
          }}
        />
      )}

      {/* INTERACTIVE STORE OPERATIONS CONTROL MODAL */}
      {showStoreModal && (
        <div className="petpooja-modal-backdrop" onClick={() => setShowStoreModal(false)}>
          <div className="petpooja-modal-card store-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="store-modal-header">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "1.3rem" }}>🏪</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>Store Operations Control</h3>
                  <p style={{ margin: 0, fontSize: "0.72rem", color: "#64748b" }}>{outletName} ({outletCode}) • Register POS-01</p>
                </div>
              </div>
              <button className="close-btn" onClick={() => setShowStoreModal(false)}>✕</button>
            </div>

            {/* Master Store Status Toggle */}
            <div className={`store-master-box ${isStoreOnline ? "is-online" : "is-offline"}`}>
              <div className="store-master-info">
                <div className="store-status-title">
                  <span className="status-dot"></span>
                  <strong>{isStoreOnline ? "STORE IS ONLINE (OPEN)" : "STORE IS PAUSED (OFFLINE)"}</strong>
                </div>
                <p className="store-status-desc">
                  {isStoreOnline
                    ? "Currently accepting orders across all active sales channels."
                    : "Store is paused. Incoming online aggregator orders and table ordering are temporarily suspended."}
                </p>
              </div>
              <button
                type="button"
                className={`store-toggle-switch ${isStoreOnline ? "active" : ""}`}
                onClick={handleToggleStore}
              >
                <span className="switch-slider"></span>
              </button>
            </div>

            {/* Channel-Specific Operation Toggles */}
            <div className="store-channels-section">
              <h4 className="channels-heading">SALES CHANNELS & SERVICE MODES</h4>

              <div className="channel-row">
                <div className="channel-info">
                  <span className="channel-icon">🍽️</span>
                  <div>
                    <div className="channel-name">Dine-In Operations</div>
                    <div className="channel-sub">Table billing, captain ordering & floor services</div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`channel-pill-btn ${dineInActive ? "active" : "inactive"}`}
                  onClick={() => {
                    const next = !dineInActive;
                    setDineInActive(next);
                    persistChannelFlag("dineInActive", next, () => setDineInActive(!next));
                  }}
                >
                  {dineInActive ? "Active" : "Paused"}
                </button>
              </div>

              <div className="channel-row">
                <div className="channel-info">
                  <span className="channel-icon">🛵</span>
                  <div>
                    <div className="channel-name">Delivery & Online Aggregators</div>
                    <div className="channel-sub">Swiggy & Zomato direct order dispatch</div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`channel-pill-btn ${deliveryActive ? "active" : "inactive"}`}
                  onClick={() => {
                    const next = !deliveryActive;
                    setDeliveryActive(next);
                    persistChannelFlag("deliveryActive", next, () => setDeliveryActive(!next));
                  }}
                >
                  {deliveryActive ? "Active" : "Paused"}
                </button>
              </div>

              <div className="channel-row">
                <div className="channel-info">
                  <span className="channel-icon">🥡</span>
                  <div>
                    <div className="channel-name">Takeaway & Direct Pickup</div>
                    <div className="channel-sub">Counter pickup & parcel orders</div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`channel-pill-btn ${takeawayActive ? "active" : "inactive"}`}
                  onClick={() => {
                    const next = !takeawayActive;
                    setTakeawayActive(next);
                    persistChannelFlag("pickupActive", next, () => setTakeawayActive(!next));
                  }}
                >
                  {takeawayActive ? "Active" : "Paused"}
                </button>
              </div>
            </div>

            {/* Quick Links & Footer */}
            <div className="store-modal-footer">
              <Link href="/channel-availability" className="store-link-btn" onClick={() => setShowStoreModal(false)}>
                📡 Aggregator Menu Status
              </Link>
              <Link href="/table-management" className="store-link-btn" onClick={() => setShowStoreModal(false)}>
                🪑 Floor Plan
              </Link>
              <button type="button" className="store-save-btn" onClick={() => setShowStoreModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INTERACTIVE LIVE ALERTS & NOTIFICATIONS MODAL */}
      {showAlertsModal && (
        <div className="petpooja-modal-backdrop" onClick={() => setShowAlertsModal(false)}>
          <div className="petpooja-modal-card alerts-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="alerts-modal-header">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "1.2rem" }}>🔔</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>Operational Alerts</h3>
                  <p style={{ margin: 0, fontSize: "0.72rem", color: "#64748b" }}>
                    {unreadAlertsCount > 0 ? `${unreadAlertsCount} unread alerts requiring attention` : "All notifications caught up"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {unreadAlertsCount > 0 && (
                  <button type="button" className="mark-all-read-btn" onClick={markAllAlertsRead}>
                    Mark all read
                  </button>
                )}
                <button className="close-btn" onClick={() => setShowAlertsModal(false)}>✕</button>
              </div>
            </div>

            {/* Alerts List Feed */}
            <div className="alerts-feed-list">
              {notifications.length === 0 ? (
                <div className="alerts-empty-state">
                  <span style={{ fontSize: "2rem" }}>🎉</span>
                  <p style={{ fontWeight: 600, color: "#334155", margin: "8px 0 0" }}>All clear!</p>
                  <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>No active operational alerts for this outlet.</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <div key={notif.id} className={`alert-item-card ${notif.isRead ? "is-read" : "is-unread"}`}>
                    <div className="alert-item-icon">
                      {notif.type === "WARNING" ? "⚠️" : notif.type === "ORDER" ? "🛵" : notif.type === "FINANCE" ? "💸" : "🛎️"}
                    </div>
                    <div className="alert-item-content">
                      <div className="alert-item-top">
                        <span className="alert-item-title">{notif.title}</span>
                        <span className="alert-item-time">{notif.time}</span>
                      </div>
                      <p className="alert-item-message">{notif.message}</p>
                    </div>
                    <button
                      type="button"
                      className="alert-dismiss-btn"
                      onClick={() => dismissAlert(notif.id)}
                      title="Dismiss alert"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="alerts-modal-footer">
              <button
                type="button"
                className="alerts-clear-btn"
                onClick={() => setNotifications([])}
                disabled={notifications.length === 0}
              >
                Clear All
              </button>
              <button type="button" className="store-save-btn" onClick={() => setShowAlertsModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support Dialog */}
      {showSupportModal && (
        <div className="petpooja-modal-backdrop" onClick={() => setShowSupportModal(false)}>
          <div className="petpooja-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>POS support</h3>
            <p style={{ margin: "12px 0", color: "var(--text-secondary)" }}>
              For billing, printers, and aggregator issues, contact your outlet manager at {outletName}.
            </p>
            <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
              <button className="petpooja-btn-secondary" onClick={() => setShowSupportModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .petpooja-top-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 48px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 12px;
          position: sticky;
          top: 0;
          z-index: 50;
          font-family: inherit;
          gap: 8px;
        }

        .petpooja-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .petpooja-hamburger-btn {
          background: transparent;
          border: none;
          color: #475569;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          border-radius: 4px;
        }
        .petpooja-hamburger-btn:hover {
          background: #f1f5f9;
        }

        .petpooja-logo-badge {
          background: #e11d48;
          color: #ffffff;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 900;
          font-size: 0.875rem;
          letter-spacing: -0.5px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .petpooja-outlet-title {
          font-size: 0.75rem;
          color: #64748b;
          white-space: nowrap;
        }
        .outlet-name-bold {
          font-weight: 700;
          color: #1e293b;
        }

        .petpooja-header-center {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-grow: 1;
          max-width: 480px;
        }

        .petpooja-new-order-btn {
          background: #dc2626;
          color: #ffffff;
          border: none;
          font-weight: 700;
          font-size: 0.8125rem;
          padding: 5px 14px;
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
          box-shadow: 0 1px 2px rgba(220, 38, 38, 0.2);
          transition: background 0.15s;
        }
        .petpooja-new-order-btn:hover {
          background: #b91c1c;
        }

        .petpooja-search-box {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          padding: 4px 10px;
          font-size: 0.75rem;
          color: #64748b;
          cursor: pointer;
          min-width: 95px;
        }
        .petpooja-search-box:hover {
          background: #f1f5f9;
          border-color: #94a3b8;
        }

        .petpooja-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .header-icon-btn {
          background: transparent;
          border: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2px 6px;
          cursor: pointer;
          color: #64748b;
          text-decoration: none;
          font-size: 0.65rem;
          position: relative;
          border-radius: 4px;
          min-width: 44px;
        }
        .header-icon-btn:hover {
          background: #f8fafc;
          color: #0f172a;
        }
        .icon-glyph {
          font-size: 0.95rem;
          line-height: 1;
        }
        .icon-caption {
          font-size: 0.625rem;
          font-weight: 500;
          margin-top: 1px;
          white-space: nowrap;
        }

        .header-icon-btn.is-active .icon-glyph {
          color: #16a34a;
        }
        .header-icon-btn.is-live .icon-glyph {
          color: #2563eb;
          animation: pulse 2s infinite;
        }

        .alert-btn {
          position: relative;
        }
        .alert-badge {
          position: absolute;
          top: 0;
          right: 6px;
          background: #dc2626;
          color: #fff;
          font-size: 0.5625rem;
          font-weight: 800;
          border-radius: 999px;
          padding: 0 4px;
          line-height: 12px;
        }

        .header-support-pill {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          padding: 2px 8px;
          background: #f8fafc;
          border-left: 1px solid #e2e8f0;
          cursor: pointer;
        }
        .support-title {
          font-size: 0.625rem;
          color: #94a3b8;
        }
        .support-phone {
          font-size: 0.6875rem;
          font-weight: 700;
          color: #3b82f6;
        }

        /* Drawer & Modals */
        .petpooja-drawer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.45);
          z-index: 100;
          display: flex;
        }
        .petpooja-side-drawer {
          width: 280px;
          height: 100%;
          background: #ffffff;
          box-shadow: 4px 0 20px rgba(0,0,0,0.15);
          display: flex;
          flex-direction: column;
          animation: slideIn 0.2s ease-out;
        }
        .drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid #e2e8f0;
        }
        .drawer-brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .drawer-brand h3 {
          margin: 0;
          font-size: 1rem;
          font-weight: 800;
        }
        .close-btn {
          background: transparent;
          border: none;
          font-size: 1.1rem;
          cursor: pointer;
          color: #64748b;
        }
        .drawer-nav-list {
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          overflow-y: auto;
        }
        .drawer-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 6px;
          color: #334155;
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 600;
        }
        .drawer-item:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .petpooja-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.5);
          z-index: 120;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .petpooja-modal-card {
          background: #ffffff;
          padding: 24px;
          border-radius: 12px;
          width: 90%;
          max-width: 440px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        .store-modal-card {
          max-width: 480px;
          padding: 20px;
        }
        .store-modal-header, .alerts-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 14px;
          border-bottom: 1px solid #e2e8f0;
          margin-bottom: 14px;
        }
        .store-master-box {
          padding: 14px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
          transition: all 0.2s ease;
        }
        .store-master-box.is-online {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
        }
        .store-master-box.is-offline {
          background: #fef2f2;
          border: 1px solid #fecaca;
        }
        .store-master-info {
          flex: 1;
        }
        .store-status-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.85rem;
        }
        .store-master-box.is-online .store-status-title {
          color: #166534;
        }
        .store-master-box.is-offline .store-status-title {
          color: #991b1b;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        .store-master-box.is-online .status-dot {
          background: #22c55e;
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
        }
        .store-master-box.is-offline .status-dot {
          background: #ef4444;
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
        }
        .store-status-desc {
          margin: 4px 0 0;
          font-size: 0.72rem;
          color: #64748b;
          line-height: 1.35;
        }
        .store-toggle-switch {
          width: 48px;
          height: 26px;
          background: #cbd5e1;
          border: none;
          border-radius: 999px;
          padding: 2px;
          cursor: pointer;
          position: relative;
          transition: background 0.2s ease;
          flex-shrink: 0;
        }
        .store-toggle-switch.active {
          background: #22c55e;
        }
        .switch-slider {
          display: block;
          width: 22px;
          height: 22px;
          background: #ffffff;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          transition: transform 0.2s ease;
          transform: translateX(0);
        }
        .store-toggle-switch.active .switch-slider {
          transform: translateX(22px);
        }
        .store-channels-section {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 16px;
        }
        .channels-heading {
          margin: 0 0 10px;
          font-size: 0.68rem;
          font-weight: 800;
          color: #64748b;
          letter-spacing: 0.04em;
        }
        .channel-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #f1f5f9;
        }
        .channel-row:last-child {
          border-bottom: none;
        }
        .channel-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .channel-icon {
          font-size: 1.1rem;
        }
        .channel-name {
          font-size: 0.8rem;
          font-weight: 700;
          color: #1e293b;
        }
        .channel-sub {
          font-size: 0.68rem;
          color: #94a3b8;
        }
        .channel-pill-btn {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.72rem;
          font-weight: 700;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
        }
        .channel-pill-btn.active {
          background: #dcfce7;
          color: #15803d;
          border: 1px solid #86efac;
        }
        .channel-pill-btn.inactive {
          background: #f1f5f9;
          color: #94a3b8;
          border: 1px solid #e2e8f0;
        }
        .store-modal-footer, .alerts-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 10px;
          border-top: 1px solid #e2e8f0;
        }
        .store-link-btn {
          font-size: 0.72rem;
          font-weight: 600;
          color: #2563eb;
          text-decoration: none;
          padding: 6px 10px;
          background: #eff6ff;
          border-radius: 6px;
          transition: background 0.15s;
        }
        .store-link-btn:hover {
          background: #dbeafe;
        }
        .store-save-btn {
          background: #0f172a;
          color: #ffffff;
          border: none;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }
        .store-save-btn:hover {
          background: #1e293b;
        }

        /* Alerts Modal */
        .alerts-modal-card {
          max-width: 480px;
          padding: 20px;
        }
        .mark-all-read-btn {
          background: none;
          border: none;
          color: #2563eb;
          font-size: 0.72rem;
          font-weight: 700;
          cursor: pointer;
          padding: 4px 6px;
        }
        .mark-all-read-btn:hover {
          text-decoration: underline;
        }
        .alerts-feed-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 320px;
          overflow-y: auto;
          margin-bottom: 14px;
        }
        .alerts-empty-state {
          padding: 28px;
          text-align: center;
        }
        .alert-item-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          transition: all 0.15s ease;
        }
        .alert-item-card.is-unread {
          background: #f8fafc;
          border-left: 3px solid #3b82f6;
        }
        .alert-item-icon {
          font-size: 1.1rem;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .alert-item-content {
          flex: 1;
          min-width: 0;
        }
        .alert-item-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .alert-item-title {
          font-size: 0.78rem;
          font-weight: 700;
          color: #0f172a;
        }
        .alert-item-time {
          font-size: 0.65rem;
          color: #94a3b8;
          white-space: nowrap;
        }
        .alert-item-message {
          margin: 3px 0 0;
          font-size: 0.72rem;
          color: #475569;
          line-height: 1.35;
        }
        .alert-dismiss-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 1rem;
          line-height: 1;
          padding: 2px 4px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .alert-dismiss-btn:hover {
          color: #ef4444;
          background: #fee2e2;
        }
        .alerts-clear-btn {
          background: none;
          border: 1px solid #e2e8f0;
          color: #64748b;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
        }
        .alerts-clear-btn:hover:not(:disabled) {
          background: #f1f5f9;
          color: #0f172a;
        }
        .alerts-clear-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .petpooja-btn-secondary {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
