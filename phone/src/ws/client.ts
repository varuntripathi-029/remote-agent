import type { PhoneIncomingMessage, PhoneOutgoingMessage } from "../types/protocol";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ClientListeners {
  onMessage: (message: PhoneIncomingMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
}

const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

/**
 * Thin wrapper around a single WebSocket to the backend's /ws/phone, with
 * reconnect-with-backoff. Deliberately knows nothing about zustand or React
 * — it just parses/emits protocol messages, matching the devagent's own
 * connect-and-reconnect loop (see devagent/main.py) so both sides degrade
 * the same way when the backend restarts.
 */
export class PhoneSocketClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(
    private url: string,
    private phoneId: string,
    private token: string,
    private listeners: ClientListeners,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  send(message: PhoneOutgoingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("[ws] dropped outgoing message, socket not open:", message);
    }
  }

  private open(): void {
    this.listeners.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_DELAY_MS;
      this.listeners.onStatus("connected");
      this.send({ type: "register", phone_id: this.phoneId, token: this.token });
    };

    ws.onmessage = (event) => {
      // Never let a malformed frame from the backend crash the app — the
      // backend itself never validates payload shape beyond routing fields,
      // so the phone has to be just as defensive.
      let message: PhoneIncomingMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        console.warn("[ws] dropping non-JSON message:", event.data);
        return;
      }
      if (!message || typeof message !== "object") {
        console.warn("[ws] dropping non-object message:", message);
        return;
      }
      this.listeners.onMessage(message);
    };

    ws.onerror = () => {
      this.listeners.onStatus("error");
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUser) {
        this.listeners.onStatus("disconnected");
        return;
      }
      this.listeners.onStatus("connecting");
      this.reconnectTimer = setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    };
  }
}
