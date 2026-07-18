import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { useAppStore } from "../src/store/useAppStore";
import { colors } from "../src/theme";

/**
 * TODO(auth): stub login per aim.md §2/§4. "Continue" performs no
 * authentication — it just proceeds using the locally generated phone_id
 * below, which today is only a WebSocket routing handle, not a verified
 * identity. Real GitHub OAuth + JWT (issued per phone→backend request) is a
 * later hardening phase; this screen is the seam it slots into.
 */
export default function LoginScreen() {
  const phoneId = useAppStore((s) => s.phoneId);
  const status = useAppStore((s) => s.connectionStatus);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DevAgent Remote</Text>
      <Text style={styles.subtitle}>Control your CLI coding agents from your phone.</Text>

      <Pressable style={styles.button} onPress={() => router.replace("/devices")}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>

      <Text style={styles.meta}>phone_id: {phoneId || "…"}</Text>
      <Text style={styles.meta}>backend: {status}</Text>

      <Pressable onPress={() => router.push("/settings")}>
        <Text style={styles.link}>Backend settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24 },
  title: { color: colors.text, fontSize: 28, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: 8, marginBottom: 24 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 12 },
  link: { color: colors.accent, fontSize: 14, marginTop: 16 },
});
