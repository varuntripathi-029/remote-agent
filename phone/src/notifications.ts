import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * Stub notification permission requester.
 * Note: expo-notifications native module was removed from Expo Go in SDK 53+.
 * This function safely performs a no-op in Expo Go and only attempts permission
 * requests in standalone/development builds.
 */
export async function registerForNotificationsStub(): Promise<void> {
  // Expo Go execution environment check
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (isExpoGo) {
    console.log("[notifications] Stub skipped: running inside Expo Go client.");
    return;
  }

  try {
    const Notifications = require("expo-notifications");
    if (Notifications?.requestPermissionsAsync) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        console.log("[notifications] permission not granted");
      }
    }
  } catch (err) {
    console.warn("[notifications] stub registration skipped", err);
  }
}


