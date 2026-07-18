import { useLayoutEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useNavigation } from "expo-router";

import { ErrorBanner } from "../src/components/ErrorBanner";
import { useAppStore } from "../src/store/useAppStore";
import { colors } from "../src/theme";

export default function DevicesScreen() {
  const navigation = useNavigation();
  const devices = useAppStore((s) => s.devices);
  const status = useAppStore((s) => s.connectionStatus);
  const connect = useAppStore((s) => s.connect);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => router.push("/settings")} hitSlop={12}>
          <Text style={styles.headerLink}>Settings</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  return (
    <View style={styles.container}>
      <ErrorBanner />

      <View style={styles.statusRow}>
        <View style={[styles.dot, status === "connected" ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.statusText}>backend: {status}</Text>
        {/* M0's `devices` snapshot is only pushed once, at registration (see
            docs/PROTOCOL.md) — reconnecting is the only way to refresh it. */}
        <Pressable onPress={connect}>
          <Text style={styles.refresh}>Refresh</Text>
        </Pressable>
      </View>

      {devices.length === 0 ? (
        <Text style={styles.empty}>
          {status === "connected" ? "No devices online yet." : "Connecting to backend…"}
        </Text>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(id) => id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/device/${item}`)}>
              <View style={[styles.dot, styles.dotOn]} />
              <Text style={styles.rowText}>{item}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  headerLink: { color: colors.accent, fontSize: 15 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: colors.success },
  dotOff: { backgroundColor: colors.muted },
  statusText: { color: colors.muted, fontSize: 13, flex: 1 },
  refresh: { color: colors.accent, fontSize: 13 },
  empty: { color: colors.muted, fontSize: 14, marginTop: 24, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowText: { color: colors.text, fontSize: 16, fontWeight: "500" },
});
