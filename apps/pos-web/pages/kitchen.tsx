import React, { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { authedFetch, useAuthGuard, verifyPin } from "../lib/auth";
import { useKapmetaSocket } from "../lib/useKapmetaSocket";
import Nav from "../components/Nav";

interface KOTItem {
  id: string;
  quantity: number;
  notes: string | null;
  course: string | null;
  servedAt: string | null;
  menuItem: {
    name: string;
  };
}

interface KOTTicket {
  id: string;
  orderId: string;
  ticketNumber: string;
  stationId: string | null;
  stationName: string | null;
  status: "QUEUED" | "PREPARING" | "READY" | "SERVED";
  createdAt: string;
  servedAt: string | null;
  kotItems: KOTItem[];
  orderType: string;
  tableNumber: string | null;
  slaWarningSeconds: number;
  slaBreachSeconds: number;
}

const COURSE_ORDER = ["STARTER", "MAIN", "DESSERT", "BEVERAGE"];
function groupByCourse(items: KOTItem[]): [string, KOTItem[]][] {
  const groups = new Map<string, KOTItem[]>();
  for (const item of items) {
    const key = item.course ?? "—";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).sort(
    ([a], [b]) => (COURSE_ORDER.indexOf(a) === -1 ? 99 : COURSE_ORDER.indexOf(a)) - (COURSE_ORDER.indexOf(b) === -1 ? 99 : COURSE_ORDER.indexOf(b))
  );
}

interface Station {
  id: string;
  name: string;
}

// Two-tone chime synthesized via Web Audio API — plays when a fresh ticket
// lands on the board so kitchen staff notice without staring at the screen.
function playNewTicketChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.11);
    });
  } catch (e) {
    console.error("chime failed", e);
  }
}

export default function KitchenMonitor() {
  const { me, loading: authLoading } = useAuthGuard("kot.read");
  const [tickets, setTickets] = useState<KOTTicket[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [activeStation, setActiveStation] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [bigScreenMode, setBigScreenMode] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Shared kitchen tablets stay logged in as one chef account all shift —
  // Lock lets whoever walks up re-verify their own PIN before touching the
  // board, same pattern as the POS Terminal lock (pages/index.tsx).
  const [isLocked, setIsLocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const handlePinSubmit = (digit: string) => {
    if (pinInput.length < 4) {
      const updated = pinInput + digit;
      setPinInput(updated);
      if (updated.length === 4) {
        verifyPin(updated).then((valid) => {
          if (valid) {
            setIsLocked(false);
            setPinInput("");
            setPinError("");
          } else {
            setPinError("Invalid Terminal PIN");
            setTimeout(() => {
              setPinInput("");
              setPinError("");
            }, 1200);
          }
        });
      }
    }
  };

  // The WS effect below mounts once and must always see the *current*
  // station tab / sound setting, not whatever they were on first render.
  const activeStationRef = React.useRef(activeStation);
  const soundOnRef = React.useRef(soundOn);
  useEffect(() => {
    activeStationRef.current = activeStation;
    soundOnRef.current = soundOn;
  }, [activeStation, soundOn]);

  const fetchStations = () => {
    authedFetch("/kitchen/stations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setStations(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const fetchTickets = () => {
    // Real API port is 4001 (apps/api API_PORT default). Route is GET /kot
    // (apps/api/src/routes/kitchen.ts, requires kot.read), authenticated via
    // authedFetch (apps/pos-web/lib/auth.ts). No hardcoded fallback tickets —
    // per repo CLAUDE.md, business/content data must come from the real API.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const station = activeStationRef.current;
    const url =
      station === "ALL"
        ? "/kitchen/kot"
        : `/kitchen/kot?stationId=${station}`;
    authedFetch(url, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout);
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json();
      })
      .then((data: KOTTicket[]) => {
        const incoming = Array.isArray(data) ? data : [];
        setTickets((prev) => {
          const prevIds = new Set(prev.map((t) => t.id));
          const hasNew = incoming.some((t) => !prevIds.has(t.id));
          if (hasNew && prev.length > 0 && soundOnRef.current) playNewTicketChime();
          return incoming;
        });
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeout);
        // Keep whatever tickets are already on screen — a transient poll
        // failure shouldn't blank out a live kitchen board.
        setLoadError(err instanceof Error ? err.message : "Failed to load kitchen queue");
        setLoading(false);
      });
  };

  // Re-fetch whenever auth resolves or the station tab changes.
  useEffect(() => {
    if (authLoading) return;
    fetchStations();
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, activeStation]);

  // Long-lived socket + backup poller + clock tick — set up once, independent
  // of station-tab switching so we don't thrash the WS connection.
  useKapmetaSocket(
    () => {
      fetchTickets();
    },
    !authLoading,
    "kitchen"
  );

  useEffect(() => {
    if (authLoading) return;

    const interval = setInterval(fetchTickets, 30000);
    const clock = setInterval(() => setNow(Date.now()), 15000);

    return () => {
      clearInterval(interval);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const updateStatus = async (ticketId: string, currentStatus: string) => {
    let nextStatus: "QUEUED" | "PREPARING" | "READY" | "SERVED" = "PREPARING";
    if (currentStatus === "QUEUED") nextStatus = "PREPARING";
    else if (currentStatus === "PREPARING") nextStatus = "READY";
    else if (currentStatus === "READY") nextStatus = "SERVED";

    setUpdatingId(ticketId);
    try {
      // #region agent log
      {
        let tokenLen = 0;
        let expiresAt: string | null = null;
        try {
          const raw = window.localStorage.getItem("kapmeta_pos_session");
          const parsed = raw ? JSON.parse(raw) : null;
          tokenLen = typeof parsed?.accessToken === "string" ? parsed.accessToken.length : 0;
          expiresAt = parsed?.expiresAt ?? null;
        } catch { /* ignore */ }
        fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K5',location:'kitchen.tsx:updateStatus',message:'KDS status click before PATCH',data:{ticketId,currentStatus,nextStatus,tokenLen,expiresAt},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
      }
      // #endregion
      const res = await authedFetch(`/kitchen/kot/${ticketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: nextStatus }),
      });
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'K5',location:'kitchen.tsx:updateStatus',message:'KDS PATCH response',data:{ticketId,nextStatus,ok:res.ok,status:res.status},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
      // #endregion
      if (res.ok) {
        // Server keeps a just-SERVED ticket in the feed for the recall grace
        // window, so we mirror that locally instead of dropping it — the
        // next poll would just bring it right back anyway.
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId ? { ...t, status: nextStatus, servedAt: nextStatus === "SERVED" ? new Date().toISOString() : t.servedAt } : t
          )
        );
      } else {
        const err = await res.json();
        setLoadError(err.error || "Failed to update ticket status");
      }
    } catch (e) {
      setLoadError("Network error updating ticket status");
    } finally {
      setUpdatingId(null);
    }
  };

  const recallTicket = async (ticketId: string) => {
    setUpdatingId(ticketId);
    try {
      const res = await authedFetch(`/kitchen/kot/${ticketId}/recall`, { method: "POST" });
      if (res.ok) {
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status: "READY", servedAt: null } : t)));
      } else {
        const err = await res.json();
        setLoadError(err.error === "TOO_LATE" ? "Recall window expired — ticket stays served" : err.error || "Recall failed");
      }
    } catch (e) {
      setLoadError("Network error recalling ticket");
    } finally {
      setUpdatingId(null);
    }
  };

  const getRecallSecondsLeft = (servedAtString: string | null) => {
    if (!servedAtString) return 0;
    const elapsed = now - new Date(servedAtString).getTime();
    return Math.max(0, Math.round((2 * 60 * 1000 - elapsed) / 1000));
  };

  const getAgeMinutes = (createdAtString: string) => {
    const ageMs = now - new Date(createdAtString).getTime();
    return Math.max(1, Math.floor(ageMs / 60000));
  };

  const getAgeSeconds = (createdAtString: string) => Math.max(0, Math.floor((now - new Date(createdAtString).getTime()) / 1000));

  return (
    <div className="kitchen-app">
      <Head>
        <title>Kapmeta POS - Kitchen Display System (KDS)</title>
        <meta
          name="description"
          content="Operations kitchen display system for food preparation tracking."
        />
      </Head>

      {isLocked && (
        <div className="terminal-lock-overlay">
          <div className="lock-card">
            <div className="lock-icon-badge">🔒</div>
            <h2 className="lock-title">Kitchen Board Locked</h2>
            <p className="lock-subtitle">Enter your PIN to resume</p>

            <div className="pin-indicator">
              {[0, 1, 2, 3].map((idx) => (
                <span
                  key={idx}
                  className={`pin-dot ${idx < pinInput.length ? "filled" : ""} ${pinError ? "error" : ""}`}
                />
              ))}
            </div>

            {pinError && <p className="pin-error-text">{pinError}</p>}

            <div className="keypad-grid">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((btn) => (
                <button
                  key={btn}
                  type="button"
                  className="keypad-btn"
                  onClick={() => {
                    if (btn === "C") setPinInput("");
                    else if (btn === "⌫") setPinInput((p) => p.slice(0, -1));
                    else handlePinSubmit(btn);
                  }}
                >
                  {btn}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {!bigScreenMode && <Nav variant="sidebar" />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Header Bar */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-badge">
            <span className="brand-icon">🍳</span>
            <span className="brand-name">Kitchen Display (KDS)</span>
          </div>
          <div className="station-tabs">
            <button
              className={`station-tab ${activeStation === "ALL" ? "active" : ""}`}
              onClick={() => setActiveStation("ALL")}
            >
              All Stations
            </button>
            {stations.map((s) => (
              <button
                key={s.id}
                className={`station-tab ${activeStation === s.id ? "active" : ""}`}
                onClick={() => setActiveStation(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <div className="topbar-right">
          <div className="queue-badge">
            <strong>{tickets.filter((t) => t.status !== "SERVED").length}</strong> active tickets
          </div>
          <Link href="/kitchen-analytics" className="icon-toggle-btn" style={{ textDecoration: "none" }}>
            📊 Prep Times
          </Link>
          <button
            className={`icon-toggle-btn ${soundOn ? "on" : ""}`}
            onClick={() => setSoundOn((v) => !v)}
            title={soundOn ? "Sound on" : "Sound off"}
          >
            {soundOn ? "🔔" : "🔕"}
          </button>
          <button
            className="icon-toggle-btn"
            onClick={() => setBigScreenMode((v) => !v)}
            title="Toggle big-screen mode"
          >
            {bigScreenMode ? "⤢ Exit" : "⛶ Big Screen"}
          </button>
          <button className="refresh-btn" onClick={fetchTickets}>
            ↻ Refresh
          </button>
          <button className="icon-toggle-btn" onClick={() => setIsLocked(true)} title="Lock Kitchen Board">
            🔒 Lock
          </button>
        </div>
      </header>

      {loadError && (
        <div className="error-banner">⚠️ {loadError}</div>
      )}

      {/* Main Board */}
      <main className={`board-content ${bigScreenMode ? "big-screen" : ""}`}>
        {authLoading ? (
          <div className="loading-card">Checking access...</div>
        ) : loading ? (
          <div className="loading-card">Loading live kitchen queue...</div>
        ) : loadError && tickets.length === 0 ? (
          <div className="empty-board-card">
            <span className="empty-icon">⚠️</span>
            <h3>Could not load kitchen queue</h3>
            <p>{loadError}. Check that the API is running and you are signed in.</p>
          </div>
        ) : tickets.filter((t) => t.status !== "SERVED").length === 0 ? (
          <div className="empty-board-card">
            <span className="empty-icon">🎉</span>
            <h3>Kitchen Queue is Clear!</h3>
            <p>All pending KOT tickets have been prepared and served.</p>
          </div>
        ) : (
          <div className="kot-cards-grid">
            {tickets.map((kot) => {
              const age = getAgeMinutes(kot.createdAt);
              const ageSeconds = getAgeSeconds(kot.createdAt);
              const isBreach = ageSeconds >= kot.slaBreachSeconds;
              const isWarning = !isBreach && ageSeconds >= kot.slaWarningSeconds;
              const isServed = kot.status === "SERVED";
              const recallSecs = isServed ? getRecallSecondsLeft(kot.servedAt) : 0;

              // Multi-station split: sibling tickets from the same order,
              // fired to different stations — kitchen needs to know these
              // belong together even though they're separate cards.
              const siblings = tickets.filter((t) => t.orderId === kot.orderId && t.id !== kot.id && t.status !== "SERVED");

              const orderTypeLabel =
                kot.orderType === "DINE_IN"
                  ? (kot.tableNumber ? `🪑 Table ${kot.tableNumber}` : "🪑 Dine-In")
                  : kot.orderType === "TAKEAWAY"
                  ? "🥡 Takeaway"
                  : kot.orderType === "DELIVERY"
                  ? "🛵 Delivery"
                  : kot.orderType === "AGGREGATOR"
                  ? "🌐 Aggregator"
                  : kot.orderType;

              return (
                <div
                  key={kot.id}
                  className={`kot-ticket-card ${
                    isServed ? "served" : isBreach ? "breach" : isWarning ? "warning" : "normal"
                  }`}
                >
                  <div className="ticket-header">
                    <div>
                      <h3 className="ticket-num">{kot.ticketNumber}</h3>
                      <span className="ticket-time">
                        {new Date(kot.createdAt).toLocaleTimeString()}
                        {kot.orderType && <span className="order-type-badge">{orderTypeLabel}</span>}
                        {kot.stationName && <span className="station-badge">{kot.stationName}</span>}
                      </span>
                      {siblings.length > 0 && (
                        <div className="linked-order-note">
                          🔗 Same order also at: {siblings.map((s) => s.stationName ?? "Unassigned").join(", ")}
                        </div>
                      )}
                    </div>
                    {!isServed && (
                      <span
                        className={`sla-pill ${
                          isBreach ? "breach" : isWarning ? "warning" : "normal"
                        } ${isBreach ? "pulse" : ""}`}
                      >
                        ⏱️ {age} min ago
                      </span>
                    )}
                  </div>

                  <div className="ticket-items-list">
                    {groupByCourse(kot.kotItems).map(([course, items]) => (
                      <div key={course} className="course-group">
                        {course !== "—" && <div className="course-label">{course}</div>}
                        {items.map((item) => (
                          <div key={item.id} className="ticket-item-row">
                            <span className="item-qty-tag">{item.quantity}x</span>
                            <div>
                              <span className="item-name-text">{item.menuItem.name}</span>
                              {item.notes && <p className="item-notes-text">📝 {item.notes}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="ticket-footer">
                    <span className={`status-chip ${kot.status.toLowerCase()}`}>
                      {kot.status}
                    </span>
                    {isServed ? (
                      recallSecs > 0 ? (
                        <button
                          className="kot-action-btn undo-btn"
                          onClick={() => recallTicket(kot.id)}
                          disabled={updatingId === kot.id}
                        >
                          {updatingId === kot.id ? "Undoing..." : `↩ Undo (${recallSecs}s)`}
                        </button>
                      ) : (
                        <span className="served-final-text">Served</span>
                      )
                    ) : (
                      <button
                        className="kot-action-btn"
                        onClick={() => updateStatus(kot.id, kot.status)}
                        disabled={updatingId === kot.id}
                      >
                        {updatingId === kot.id
                          ? "Updating..."
                          : kot.status === "QUEUED"
                          ? "▶ Start Cooking"
                          : kot.status === "PREPARING"
                          ? "✓ Mark Ready"
                          : "★ Complete & Serve"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .terminal-lock-overlay { position: fixed; inset: 0; z-index: 100; background: var(--dark-btn); display: flex; align-items: center; justify-content: center; }
        .lock-card { background: var(--bg-card); border-radius: var(--radius-lg); padding: 40px; width: 340px; text-align: center; box-shadow: var(--shadow-modal); }
        .lock-icon-badge { font-size: 2.5rem; margin-bottom: 8px; }
        .lock-title { margin: 0 0 4px; font-size: 1.25rem; font-weight: 800; }
        .lock-subtitle { margin: 0 0 16px; color: var(--text-secondary); font-size: 0.8125rem; }
        .pin-indicator { display: flex; justify-content: center; gap: 12px; margin-bottom: 8px; }
        .pin-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); }
        .pin-dot.filled { background: var(--accent); border-color: var(--accent); }
        .pin-dot.error { background: var(--destructive); border-color: var(--destructive); }
        .pin-error-text { color: var(--destructive); font-size: 0.8125rem; font-weight: 600; margin: 8px 0; }
        .keypad-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 20px 0 12px; }
        .keypad-btn { padding: 16px 0; font-size: 1.125rem; font-weight: 700; background: var(--bg-subtle); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; min-height: 44px; }
        .keypad-btn:hover { background: var(--bg-hover); }

        .kitchen-app {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
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
          padding: 0 20px;
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

        .station-tabs {
          display: flex;
          gap: 4px;
          background-color: var(--bg-subtle);
          padding: 4px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border);
          overflow-x: auto;
          max-width: 480px;
        }

        .station-tab {
          padding: 6px 14px;
          border-radius: var(--radius-pill);
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          white-space: nowrap;
          cursor: pointer;
        }

        .station-tab.active {
          background-color: var(--bg-card);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
        }

        .icon-toggle-btn {
          padding: 8px 12px;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .icon-toggle-btn.on {
          color: var(--accent-subtle-text);
          background: var(--accent-subtle);
        }

        .error-banner {
          background: var(--destructive-subtle);
          color: var(--destructive-text);
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 8px 20px;
          border-bottom: 1px solid var(--border);
        }

        .station-badge {
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: var(--radius-pill);
          background: var(--bg-subtle);
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-secondary);
        }

        .order-type-badge {
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: var(--radius-pill);
          background: var(--accent-subtle);
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--accent-subtle-text);
        }

        .item-notes-text {
          margin: 2px 0 0 0;
          font-size: 0.75rem;
          font-style: italic;
          color: var(--warning-text);
        }

        .linked-order-note {
          margin-top: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--blue-text, #1d4ed8);
        }

        .course-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .course-group + .course-group {
          margin-top: 10px;
        }

        .course-label {
          font-size: 0.6875rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          border-bottom: 1px dashed var(--border);
          padding-bottom: 4px;
          margin-bottom: 2px;
        }

        .kot-ticket-card.served {
          opacity: 0.6;
          border-left: 6px solid var(--text-muted);
        }

        .undo-btn {
          background: var(--warning) !important;
        }

        .served-final-text {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-muted);
        }

        .board-content.big-screen {
          padding: 32px;
        }

        .board-content.big-screen .kot-cards-grid {
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
          gap: 28px;
        }

        .board-content.big-screen .ticket-num {
          font-size: 1.5rem;
        }

        .board-content.big-screen .item-name-text {
          font-size: 1.25rem;
        }

        .board-content.big-screen .item-qty-tag {
          font-size: 1.0625rem;
        }

        .sla-pill.pulse {
          animation: sla-pulse 1.2s ease-in-out infinite;
        }

        @keyframes sla-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
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
          gap: 12px;
        }

        .queue-badge {
          font-size: 0.8125rem;
          color: var(--text-secondary);
          padding: 6px 12px;
          background: var(--bg-subtle);
          border-radius: var(--radius-pill);
        }

        .refresh-btn {
          padding: 8px 16px;
          background: var(--dark-btn);
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
        }

        .board-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .kot-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }

        .kot-ticket-card {
          background-color: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: var(--shadow-card);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .kot-ticket-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-pop);
        }

        .kot-ticket-card.breach {
          border-left: 6px solid var(--destructive);
        }

        .kot-ticket-card.warning {
          border-left: 6px solid var(--warning);
        }

        .kot-ticket-card.normal {
          border-left: 6px solid var(--accent);
        }

        .ticket-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle);
          margin-bottom: 14px;
        }

        .ticket-num {
          margin: 0 0 4px 0;
          font-size: 1.0625rem;
          font-weight: 800;
        }

        .ticket-time {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .sla-pill {
          padding: 4px 10px;
          border-radius: var(--radius-pill);
          font-size: 0.75rem;
          font-weight: 700;
        }

        .sla-pill.normal {
          background: var(--accent-subtle);
          color: var(--accent-subtle-text);
        }

        .sla-pill.warning {
          background: var(--warning-subtle);
          color: var(--warning-text);
        }

        .sla-pill.breach {
          background: var(--destructive-subtle);
          color: var(--destructive-text);
        }

        .ticket-items-list {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 18px;
        }

        .ticket-item-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .item-qty-tag {
          padding: 4px 8px;
          background: var(--bg-subtle);
          border-radius: var(--radius-sm);
          font-size: 0.8125rem;
          font-weight: 800;
          color: var(--text-primary);
        }

        .item-name-text {
          font-size: 0.9375rem;
          font-weight: 600;
        }

        .ticket-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 14px;
          border-top: 1px solid var(--border-subtle);
        }

        .status-chip {
          padding: 4px 10px;
          border-radius: var(--radius-pill);
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
        }

        .status-chip.queued {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .status-chip.preparing {
          background: #fffbeb;
          color: #92400e;
        }

        .status-chip.ready {
          background: #ecfdf5;
          color: #065f46;
        }

        .kot-action-btn {
          padding: 8px 16px;
          background: var(--dark-btn);
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
          min-height: 40px;
        }

        .kot-action-btn:hover {
          background: var(--dark-btn-hover);
        }

        .loading-card, .empty-board-card {
          background: var(--bg-card);
          border: 1px dashed var(--border);
          border-radius: var(--radius-lg);
          padding: 60px 20px;
          text-align: center;
          color: var(--text-secondary);
        }

        .empty-icon {
          font-size: 3rem;
          margin-bottom: 12px;
        }
      ` }} />
      </div>
      </div>
    </div>
  );
}
