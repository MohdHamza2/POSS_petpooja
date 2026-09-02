import { useEffect, useRef } from "react";
import { getWsBase } from "./auth";

export const FLOOR_EVENT_TOPICS = new Set([
  "table.status_updated",
  "table.merged",
  "table.unmerged",
  "table.transferred",
  "table.updated",
  "kot.created",
  "kot.status_updated",
  "order.status_updated",
  "order.created",
  "order.updated",
  "finance.order_settled",
  "finance.waiter_shift_handover",
  "finance.petty_cash",
  "inventory.stock_updated",
  "outlet.store_status_updated",
]);

export type KapmetaSocketPayload = { topic: string; data?: Record<string, unknown> };

export function useKapmetaSocket(
  onEvent: (payload: KapmetaSocketPayload) => void,
  enabled: boolean,
  source: string
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(getWsBase());
      } catch {
        if (!closed) retry = setTimeout(connect, 3000);
        return;
      }

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as KapmetaSocketPayload;
          if (!payload?.topic || !FLOOR_EVENT_TOPICS.has(payload.topic)) return;


          onEventRef.current(payload);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // already closed
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, [enabled, source]);
}
