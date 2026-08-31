import React from "react";

interface CaptainNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  outletName?: string;
  stationCode?: string;
  appVersion?: string;
  staffName?: string;
  unsuccessfulCount?: number;
  onNewKot: () => void;
  onOpenUnsuccessfulModal: () => void;
  onSyncData: () => void;
  onUpdateMenu: () => void;
  onOpenServerIpModal: () => void;
  onOpenCashTipsCalculator?: () => void;
  onOpenSettings: () => void;
  onLogout?: () => void;
}

export default function CaptainNavDrawer({
  isOpen,
  onClose,
  outletName = "Outlet",
  stationCode = "cp4",
  appVersion = "V 15.0.0 (2009)",
  staffName,
  unsuccessfulCount = 0,
  onNewKot,
  onOpenUnsuccessfulModal,
  onSyncData,
  onUpdateMenu,
  onOpenServerIpModal,
  onOpenCashTipsCalculator,
  onOpenSettings,
  onLogout,
}: CaptainNavDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="captain-drawer-backdrop" onClick={onClose}>
      <div className="captain-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Captain Brand Header */}
        <div className="captain-drawer-header">
          <div className="brand-badge-box">
            <div className="brand-logo-icon">
              🍽️
            </div>
            <div className="brand-titles">
              <div className="brand-title">PETPOOJA</div>
              <div className="brand-subtitle">CAPTAIN TABLET</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-close-drawer"
              title="Close Drawer"
            >
              ✕
            </button>
          </div>

          <div className="captain-meta-info">
            <div className="version-station-row">
              <span className="version-text">{appVersion}</span>
              <span className="station-badge">● Station {stationCode}</span>
            </div>
            <div className="outlet-name-text">
              <span className="hotel-icon">🏨</span> {outletName}
            </div>
          </div>
        </div>

        {/* Action Menu List */}
        <div className="captain-menu-list">
          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              onNewKot();
              onClose();
            }}
          >
            <span className="menu-icon">📝</span>
            <span className="menu-label">New KOT</span>
          </button>

          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              if (onOpenCashTipsCalculator) onOpenCashTipsCalculator();
              onClose();
            }}
          >
            <span className="menu-icon">💰</span>
            <span className="menu-label">Shift Cash & Tips</span>
          </button>

          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              onOpenUnsuccessfulModal();
              onClose();
            }}
          >
            <span className="menu-icon">⚠️</span>
            <span className="menu-label">Unsuccessful KOT</span>
            {unsuccessfulCount > 0 && (
              <span className="unsuccessful-badge">{unsuccessfulCount}</span>
            )}
          </button>

          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              onSyncData();
              onClose();
            }}
          >
            <span className="menu-icon">🔄</span>
            <span className="menu-label">Sync Data</span>
          </button>

          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              onUpdateMenu();
              onClose();
            }}
          >
            <span className="menu-icon">🍴</span>
            <span className="menu-label">Update Menu</span>
          </button>

          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              onOpenServerIpModal();
              onClose();
            }}
          >
            <span className="menu-icon">🌐</span>
            <span className="menu-label">Find Server IP</span>
          </button>

          <button
            type="button"
            className="menu-item-btn"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            <span className="menu-icon">⚙️</span>
            <span className="menu-label">Station Settings</span>
          </button>
        </div>

        {/* Drawer Footer: Staff Profile & Logout */}
        <div className="captain-drawer-footer">
          {staffName && (
            <div className="staff-profile-chip">
              <span className="staff-avatar">🧑‍🍳</span>
              <div className="staff-details">
                <span className="staff-label">Logged In Waiter</span>
                <span className="staff-name">{staffName}</span>
              </div>
            </div>
          )}

          {onLogout && (
            <button
              type="button"
              className="btn-logout-drawer"
              onClick={() => {
                onClose();
                onLogout();
              }}
            >
              <span className="logout-icon">🚪</span>
              <span>Log Out / End Shift</span>
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .captain-drawer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(2, 6, 23, 0.7);
          backdrop-filter: blur(4px);
          z-index: 200;
          display: flex;
        }

        .captain-drawer-panel {
          width: 300px;
          height: 100%;
          background: #0f172a;
          border-right: 1px solid #1e293b;
          box-shadow: 8px 0 30px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          animation: slideDrawer 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .captain-drawer-header {
          padding: 20px 18px 16px 18px;
          background: #1e293b;
          border-bottom: 1px solid #334155;
        }

        .brand-badge-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .brand-logo-icon {
          width: 38px;
          height: 38px;
          background: #3b82f6;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.25rem;
          box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4);
        }
        .brand-titles {
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        .brand-title {
          font-size: 0.875rem;
          font-weight: 900;
          color: #60a5fa;
          letter-spacing: 0.5px;
        }
        .brand-subtitle {
          font-size: 0.6875rem;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 1px;
        }
        .btn-close-drawer {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 1.125rem;
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-close-drawer:hover {
          color: #ffffff;
          background: #334155;
        }

        .captain-meta-info {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .version-station-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.6875rem;
          color: #94a3b8;
        }
        .station-badge {
          color: #facc15;
          font-weight: 700;
        }
        .outlet-name-text {
          font-size: 0.75rem;
          font-weight: 700;
          color: #e2e8f0;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .captain-menu-list {
          padding: 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          overflow-y: auto;
        }

        .menu-item-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: transparent;
          border: none;
          border-radius: 10px;
          color: #cbd5e1;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.15s;
          position: relative;
        }
        .menu-item-btn:hover {
          background: #1e293b;
          color: #ffffff;
          transform: translateX(3px);
        }

        .menu-icon {
          font-size: 1.1rem;
        }
        .menu-label {
          flex: 1;
        }

        .unsuccessful-badge {
          background: #dc2626;
          color: #ffffff;
          font-size: 0.6875rem;
          font-weight: 800;
          padding: 2px 7px;
          border-radius: 999px;
        }

        .captain-drawer-footer {
          padding: 14px;
          border-top: 1px solid #1e293b;
          background: #0b1120;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .staff-profile-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #1e293b;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid #334155;
        }
        .staff-avatar {
          font-size: 1.25rem;
        }
        .staff-details {
          display: flex;
          flex-direction: column;
        }
        .staff-label {
          font-size: 0.625rem;
          color: #94a3b8;
          font-weight: 600;
          text-transform: uppercase;
        }
        .staff-name {
          font-size: 0.8125rem;
          color: #f8fafc;
          font-weight: 800;
        }

        .btn-logout-drawer {
          background: #7f1d1d;
          border: 1px solid #b91c1c;
          color: #fecaca;
          font-size: 0.8125rem;
          font-weight: 700;
          padding: 10px 14px;
          border-radius: 10px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.15s;
          box-shadow: 0 2px 6px rgba(185, 28, 28, 0.2);
        }
        .btn-logout-drawer:hover {
          background: #991b1b;
          color: #ffffff;
          border-color: #ef4444;
        }
        .logout-icon {
          font-size: 1rem;
        }

        @keyframes slideDrawer {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
