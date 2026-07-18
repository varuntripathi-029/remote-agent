import { Pressable, StyleSheet, Text } from "react-native";

import { useAppStore } from "../store/useAppStore";
import { colors } from "../theme";

/** Renders the backend's top-level {"type":"error",...} messages (e.g.
 * device_offline, bad_message) — see docs/PROTOCOL.md. Tap to dismiss. */
export function ErrorBanner() {
  const error = useAppStore((s) => s.lastError);
  const dismiss = useAppStore((s) => s.dismissError);
  if (!error) return null;

  const message =
    error.reason === "device_offline"
      ? `Device ${error.device_id ?? "?"} is offline.`
      : error.detail || error.reason;

  return (
    <Pressable style={styles.banner} onPress={dismiss}>
      <Text style={styles.text}>{message}</Text>
      <Text style={styles.dismiss}>dismiss ✕</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.danger,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  text: { color: "#fff", flex: 1, fontSize: 13 },
  dismiss: { color: "#fff", fontSize: 12, opacity: 0.8, marginLeft: 8 },
});
