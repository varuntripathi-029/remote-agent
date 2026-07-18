import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { useAppStore } from "../src/store/useAppStore";
import { colors } from "../src/theme";

export default function SettingsScreen() {
  const backendHost = useAppStore((s) => s.backendHost);
  const setBackendHost = useAppStore((s) => s.setBackendHost);
  const status = useAppStore((s) => s.connectionStatus);
  const phoneId = useAppStore((s) => s.phoneId);
  const [value, setValue] = useState(backendHost);

  const handleSave = async () => {
    await setBackendHost(value.trim());
    router.back();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Backend host (LAN IP:port)</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="192.168.1.23:8000"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.hint}>
        Expo Go runs on this phone, so "localhost" would mean the phone itself, not your
        PC. Use your PC's LAN IP, start the backend with{" "}
        <Text style={styles.code}>uvicorn main:app --host 0.0.0.0 --port 8000</Text>, and
        make sure the phone is on the same Wi-Fi network.
      </Text>

      <Text style={styles.label}>Status</Text>
      <Text style={styles.value}>{status}</Text>

      <Text style={styles.label}>phone_id</Text>
      <Text style={styles.value}>{phoneId}</Text>

      <Pressable style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save & Reconnect</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", marginTop: 20, marginBottom: 8 },
  value: { color: colors.text, fontSize: 14 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 12, marginTop: 12, lineHeight: 18 },
  code: { fontFamily: "monospace", color: colors.text },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 32,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
