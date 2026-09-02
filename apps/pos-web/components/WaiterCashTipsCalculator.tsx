import React, { useState, useEffect, useMemo } from "react";
import { authedFetch } from "../lib/auth";

interface Denominations {
  n500: number;
  n200: number;
  n100: number;
  n50: number;
  n20: number;
  n10: number;
  n5: number;
  coins: number;
}

interface ShiftData {
  waiter: { id: string; name: string; email: string };
  shiftDate: string;
  orderCount: number;
  cashSalesMinor: string;
  cardSalesMinor: string;
  upiSalesMinor: string;
  digitalTipsMinor: string;
  serviceChargeMinor?: string;
  totalRevenueMinor: string;
  recentOrders: any[];
}

interface WaiterCashTipsCalculatorProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WaiterCashTipsCalculator({
  isOpen,
  onClose,
}: WaiterCashTipsCalculatorProps) {
  const [shiftData, setShiftData] = useState<ShiftData | null>(null);
  const [loading, setLoading] = useState(true);

  // Cash Ledger States
  const [openingFloat, setOpeningFloat] = useState(0);
  const [cashDrop, setCashDrop] = useState(0);
  const [directCashTips, setDirectCashTips] = useState(0);
  const [tipSharePercent, setTipSharePercent] = useState(10); // 10% to kitchen / busboys

  // Physical Cash Denominations Count
  const [denoms, setDenoms] = useState<Denominations>({
    n500: 0,
    n200: 0,
    n100: 0,
    n50: 0,
    n20: 0,
    n10: 0,
    n5: 0,
    coins: 0,
  });

  useEffect(() => {
    if (isOpen) {
      loadShiftData();
    }
  }, [isOpen]);

  const loadShiftData = async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/waiters/me/shift-reconciliation");
      if (res.ok) {
        const data = await res.json();
        setShiftData(data);
      }
      const savedFloat = localStorage.getItem("kapmeta_captain_opening_float");
      if (savedFloat != null && savedFloat !== "") {
        setOpeningFloat(parseFloat(savedFloat) || 0);
      } else {
        const drawerRes = await authedFetch("/finance/cash-drawer");
        if (drawerRes.ok) {
          const drawer = await drawerRes.json();
          setOpeningFloat(Number(drawer.openingFloatMinor || 0) / 100);
        } else {
          setOpeningFloat(0);
        }
      }
    } catch (e) {
      console.error("Failed to load shift reconciliation", e);
    } finally {
      setLoading(false);
    }
  };

  const updateDenom = (field: keyof Denominations, val: string) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setDenoms((prev) => ({ ...prev, [field]: num }));
  };

  // Calculations
  const totalCountedCash = useMemo(() => {
    return (
      denoms.n500 * 500 +
      denoms.n200 * 200 +
      denoms.n100 * 100 +
      denoms.n50 * 50 +
      denoms.n20 * 20 +
      denoms.n10 * 10 +
      denoms.n5 * 5 +
      denoms.coins
    );
  }, [denoms]);

  const cashSales = useMemo(() => {
    return Number(shiftData?.cashSalesMinor || 0) / 100;
  }, [shiftData]);

  const cardSales = useMemo(() => {
    return Number(shiftData?.cardSalesMinor || 0) / 100;
  }, [shiftData]);

  const upiSales = useMemo(() => {
    return Number(shiftData?.upiSalesMinor || 0) / 100;
  }, [shiftData]);

  const digitalTips = useMemo(() => {
    return Number(shiftData?.digitalTipsMinor || 0) / 100;
  }, [shiftData]);

  const totalTips = digitalTips + directCashTips;
  const tipShareAmount = (totalTips * tipSharePercent) / 100;
  const netWaiterTipPayout = totalTips - tipShareAmount;

  // Expected Physical Cash in Hand = Opening Float + Cash Sales + Direct Cash Tips - Cash Drops
  const expectedCashInHand = openingFloat + cashSales + directCashTips - cashDrop;
  const cashVariance = totalCountedCash - expectedCashInHand;

  if (!isOpen) return null;

  const handlePrintReport = () => {
    window.print();
  };

  return (
    <div className="calc-backdrop" onClick={onClose}>
      <div className="calc-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="calc-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.5rem" }}>💰</span>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800 }}>
                Waiter Shift Cash & Tips Reconciliation
              </h3>
              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                Shift Cash Drawer Balance & Tips Settlement • {shiftData?.waiter?.name || "Captain"}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "#94a3b8" }}>
            Aggregating today's transactions and sales ledger...
          </div>
        ) : (
          <div className="calc-content-scroll">
            {/* Sales Breakdown Grid */}
            <div className="sales-metrics-grid">
              <div className="metric-box box-cash">
                <span className="metric-title">💵 Cash Sales</span>
                <span className="metric-value">₹{cashSales.toFixed(2)}</span>
              </div>
              <div className="metric-box box-card">
                <span className="metric-title">💳 Card Sales</span>
                <span className="metric-value">₹{cardSales.toFixed(2)}</span>
              </div>
              <div className="metric-box box-upi">
                <span className="metric-title">📱 UPI / QR Sales</span>
                <span className="metric-value">₹{upiSales.toFixed(2)}</span>
              </div>
              <div className="metric-box box-total">
                <span className="metric-title">📊 Total Shift Sales</span>
                <span className="metric-value">
                  ₹{((Number(shiftData?.totalRevenueMinor || 0)) / 100).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Split Screen: Physical Cash Calculator & Tips Ledger */}
            <div className="two-column-layout">
              {/* Left Column: Physical Cash Denomination Counter */}
              <div className="column-pane">
                <h4 className="pane-title">💵 Physical Cash Denominations Count</h4>

                <div className="denom-grid">
                  <div className="denom-row">
                    <span className="denom-label">₹500 x</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.n500 || ""}
                      onChange={(e) => updateDenom("n500", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.n500 * 500}</span>
                  </div>

                  <div className="denom-row">
                    <span className="denom-label">₹200 x</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.n200 || ""}
                      onChange={(e) => updateDenom("n200", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.n200 * 200}</span>
                  </div>

                  <div className="denom-row">
                    <span className="denom-label">₹100 x</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.n100 || ""}
                      onChange={(e) => updateDenom("n100", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.n100 * 100}</span>
                  </div>

                  <div className="denom-row">
                    <span className="denom-label">₹50 x</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.n50 || ""}
                      onChange={(e) => updateDenom("n50", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.n50 * 50}</span>
                  </div>

                  <div className="denom-row">
                    <span className="denom-label">₹20 x</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.n20 || ""}
                      onChange={(e) => updateDenom("n20", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.n20 * 20}</span>
                  </div>

                  <div className="denom-row">
                    <span className="denom-label">₹10 x</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.n10 || ""}
                      onChange={(e) => updateDenom("n10", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.n10 * 10}</span>
                  </div>

                  <div className="denom-row">
                    <span className="denom-label">Coins (₹)</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms.coins || ""}
                      onChange={(e) => updateDenom("coins", e.target.value)}
                      className="denom-input"
                      placeholder="0"
                    />
                    <span className="denom-subtotal">= ₹{denoms.coins}</span>
                  </div>
                </div>

                <div className="total-counted-banner">
                  <span>Total Counted Physical Cash:</span>
                  <strong style={{ fontSize: "1.1rem" }}>₹{totalCountedCash.toFixed(2)}</strong>
                </div>
              </div>

              {/* Right Column: Reconciliation & Tips Distribution */}
              <div className="column-pane">
                <h4 className="pane-title">⚖️ Shift Cash Reconciliation</h4>

                <div className="reconcile-field-list">
                  <div className="reconcile-row">
                    <span>Opening Cash Float:</span>
                    <input
                      type="number"
                      value={openingFloat}
                      onChange={(e) => setOpeningFloat(parseFloat(e.target.value) || 0)}
                      className="small-num-input"
                    />
                  </div>

                  <div className="reconcile-row">
                    <span>+ Shift Cash Sales:</span>
                    <strong>₹{cashSales.toFixed(2)}</strong>
                  </div>

                  <div className="reconcile-row">
                    <span>+ Direct Cash Tips:</span>
                    <input
                      type="number"
                      value={directCashTips}
                      onChange={(e) => setDirectCashTips(parseFloat(e.target.value) || 0)}
                      className="small-num-input"
                    />
                  </div>

                  <div className="reconcile-row">
                    <span>- Mid-Shift Cash Drop (Safe Handover):</span>
                    <input
                      type="number"
                      value={cashDrop}
                      onChange={(e) => setCashDrop(parseFloat(e.target.value) || 0)}
                      className="small-num-input"
                    />
                  </div>

                  <div className="reconcile-divider" />

                  <div className="reconcile-row" style={{ fontWeight: 700 }}>
                    <span>Expected Drawer Cash:</span>
                    <span>₹{expectedCashInHand.toFixed(2)}</span>
                  </div>

                  <div className="reconcile-row" style={{ fontWeight: 700 }}>
                    <span>Actual Counted Cash:</span>
                    <span>₹{totalCountedCash.toFixed(2)}</span>
                  </div>

                  {/* Overage / Shortage Badge */}
                  <div className={`variance-banner ${Math.abs(cashVariance) < 0.01 ? "match" : cashVariance > 0 ? "overage" : "shortage"}`}>
                    {Math.abs(cashVariance) < 0.01 ? (
                      <span>✓ Perfect Match (₹0.00 Variance)</span>
                    ) : cashVariance > 0 ? (
                      <span>🟢 Cash Overage: +₹{cashVariance.toFixed(2)}</span>
                    ) : (
                      <span>⚠️ Cash Shortage: -₹{Math.abs(cashVariance).toFixed(2)}</span>
                    )}
                  </div>
                </div>

                {/* Tips Distribution Section */}
                <h4 className="pane-title" style={{ marginTop: "18px" }}>🎁 Tips Breakdown & Payout</h4>

                <div className="tips-calc-box">
                  <div className="reconcile-row">
                    <span>Digital Bill Tips:</span>
                    <strong>₹{digitalTips.toFixed(2)}</strong>
                  </div>
                  <div className="reconcile-row">
                    <span>Cash Tips:</span>
                    <strong>₹{directCashTips.toFixed(2)}</strong>
                  </div>
                  <div className="reconcile-row" style={{ fontWeight: 700, color: "#16a34a" }}>
                    <span>Total Tips Earned:</span>
                    <span>₹{totalTips.toFixed(2)}</span>
                  </div>

                  <div className="reconcile-row" style={{ marginTop: "6px", fontSize: "0.75rem", color: "#64748b" }}>
                    <span>Tip Share Pool (% to Kitchen/Runners):</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={tipSharePercent}
                      onChange={(e) => setTipSharePercent(parseFloat(e.target.value) || 0)}
                      className="small-num-input"
                      style={{ width: "50px" }}
                    />
                  </div>

                  <div className="reconcile-row" style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                    <span>Kitchen Pool Contribution:</span>
                    <span>-₹{tipShareAmount.toFixed(2)}</span>
                  </div>

                  <div className="net-tip-banner">
                    <span>Net Captain Tip Take-Home:</span>
                    <strong style={{ fontSize: "1.1rem", color: "#15803d" }}>
                      ₹{netWaiterTipPayout.toFixed(2)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="calc-footer">
          <button type="button" className="btn-print" onClick={handlePrintReport}>
            🖨️ Print Shift Z-Report
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn-close" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn-complete-shift"
              onClick={async () => {
                try {
                  const res = await authedFetch("/waiters/me/shift-handover", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      actualCashCountedMinor: Math.round(totalCountedCash * 100),
                      openingFloatMinor: Math.round(openingFloat * 100),
                      netTipPayoutMinor: Math.round(netWaiterTipPayout * 100),
                      digitalTipsMinor: Number(shiftData?.digitalTipsMinor || 0),
                      serviceChargeMinor: Number((shiftData as any)?.serviceChargeMinor || 0),
                      cashSalesMinor: Number(shiftData?.cashSalesMinor || 0),
                      managerNotes: `Captain Shift Handover: ${shiftData?.waiter?.name || "Captain"}. Net tip payout: ₹${netWaiterTipPayout.toFixed(2)}, Denominations: 500x${denoms.n500}, 200x${denoms.n200}, 100x${denoms.n100}, 50x${denoms.n50}, 20x${denoms.n20}, 10x${denoms.n10}, Coins: ₹${denoms.coins}`,
                    }),
                  });
                  if (res.ok) {
                    alert(`Captain handover saved for ${shiftData?.waiter?.name || "Captain"}.\n\nTotal Cash Counted: ₹${totalCountedCash.toFixed(2)}\nNet Tip Payout: ₹${netWaiterTipPayout.toFixed(2)}\nVariance: ${cashVariance >= 0 ? "+" : "-"}₹${Math.abs(cashVariance).toFixed(2)}\n\nHouse cash drawer was NOT closed. Finance sees this handover live.`);
                  } else {
                    const errData = await res.json().catch(() => ({}));
                    alert(errData.error || "Handover failed");
                    return;
                  }
                } catch {
                  alert("Network error saving captain handover. House drawer was not touched.");
                  return;
                }
                onClose();
              }}
            >
              ✓ Complete Shift & Handover
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .calc-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(3px);
          z-index: 250;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
        }

        .calc-modal-card {
          background: #ffffff;
          border-radius: 16px;
          padding: 20px 24px;
          width: 95%;
          max-width: 820px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
        }

        .calc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 12px;
        }
        .close-btn {
          background: transparent;
          border: none;
          font-size: 1.2rem;
          color: #64748b;
          cursor: pointer;
        }

        .calc-content-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 14px 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .sales-metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
        }
        .metric-box {
          padding: 10px 12px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .metric-title {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .metric-value {
          font-size: 1.1rem;
          font-weight: 900;
        }

        .box-cash { background: #dcfce7; color: #166534; }
        .box-card { background: #dbeafe; color: #1e40af; }
        .box-upi { background: #f3e8ff; color: #6b21a8; }
        .box-total { background: #f1f5f9; color: #0f172a; }

        .two-column-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .column-pane {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 14px;
        }
        .pane-title {
          margin: 0 0 10px 0;
          font-size: 0.8125rem;
          font-weight: 800;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .denom-grid {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .denom-row {
          display: grid;
          grid-template-columns: 70px 70px 1fr;
          align-items: center;
          gap: 8px;
          font-size: 0.8125rem;
        }
        .denom-label {
          font-weight: 600;
          color: #475569;
        }
        .denom-input {
          padding: 4px 6px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          text-align: center;
          font-weight: 700;
          font-size: 0.8125rem;
        }
        .denom-subtotal {
          text-align: right;
          font-weight: 700;
          color: #0f172a;
        }

        .total-counted-banner {
          margin-top: 12px;
          padding: 8px 12px;
          background: #e2e8f0;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.8125rem;
          font-weight: 700;
        }

        .reconcile-field-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 0.8125rem;
        }
        .reconcile-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .small-num-input {
          width: 80px;
          padding: 3px 6px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          text-align: right;
          font-weight: 700;
          font-size: 0.8125rem;
        }
        .reconcile-divider {
          height: 1px;
          background: #e2e8f0;
          margin: 6px 0;
        }

        .variance-banner {
          margin-top: 8px;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 0.8125rem;
          font-weight: 800;
          text-align: center;
        }
        .variance-banner.match { background: #dcfce7; color: #15803d; }
        .variance-banner.overage { background: #eff6ff; color: #1d4ed8; }
        .variance-banner.shortage { background: #fee2e2; color: #b91c1c; }

        .tips-calc-box {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 0.8125rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          padding: 10px;
          border-radius: 8px;
        }
        .net-tip-banner {
          margin-top: 6px;
          padding: 8px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.8125rem;
          font-weight: 700;
        }

        .calc-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
        }
        .btn-print {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-close {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.8125rem;
          cursor: pointer;
        }
        .btn-complete-shift {
          background: #16a34a;
          color: #ffffff;
          border: none;
          padding: 8px 18px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.8125rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
