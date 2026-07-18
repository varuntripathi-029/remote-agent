import * as Notifications from "expo-notifications";

/**
 * TODO(push): this only requests local-notification permission as a stub —
 * it does not register a push token or send anything to the backend. Real
 * push (getExpoPushTokenAsync, persisting the token server-side, and having
 * a task.result/approval.request trigger a notification for a backgrounded
 * phone) is a later hardening-phase item per aim.md's build order. Note
 * Expo Go's own support for remote push is limited on recent SDKs (local
 * notifications still work); this stub deliberately stays local-only.
 */
export async function registerForNotificationsStub(): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") {
      console.log("[notifications] permission not granted (stub, no-op)");
    }
  } catch (err) {
    console.warn("[notifications] stub registration failed", err);
  }
}
