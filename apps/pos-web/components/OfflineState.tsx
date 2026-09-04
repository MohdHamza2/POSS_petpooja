import React from "react";

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      backgroundColor: "var(--bg-base, #f8fafc)",
      color: "var(--text-primary, #0f172a)",
      fontFamily: "var(--font-sans, inherit)",
      textAlign: "center",
      padding: "2rem"
    }}>
      <div style={{
        backgroundColor: "var(--bg-card, #ffffff)",
        padding: "3rem",
        borderRadius: "var(--radius-lg, 16px)",
        boxShadow: "var(--shadow-pop, 0 10px 25px -3px rgba(0,0,0,0.1))",
        maxWidth: "400px",
        width: "100%"
      }}>
        <svg
          style={{ width: "64px", height: "64px", margin: "0 auto 1.5rem", color: "var(--destructive, #ef4444)" }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 1rem" }}>System Offline</h2>
        <p style={{ color: "var(--text-secondary, #64748b)", margin: "0 0 2rem", lineHeight: 1.5 }}>
          The Kapmeta POS is currently unable to reach the API server. Please check your network connection or ensure the local server is running.
        </p>
        <button
          onClick={onRetry}
          style={{
            backgroundColor: "var(--dark-btn, #0f172a)",
            color: "#ffffff",
            border: "none",
            borderRadius: "var(--radius-md, 10px)",
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
            transition: "background-color 0.2s"
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--dark-btn-hover, #1e293b)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "var(--dark-btn, #0f172a)")}
        >
          Retry Connection
        </button>
      </div>
    </div>
  );
}
