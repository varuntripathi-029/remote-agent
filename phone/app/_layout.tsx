import { useEffect } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { colors } from "../src/theme";
import { useAppStore } from "../src/store/useAppStore";
import { registerForNotificationsStub } from "../src/notifications";

export default function RootLayout() {
  const hydrate = useAppStore((s) => s.hydrate);
  const connect = useAppStore((s) => s.connect);
  const hydrated = useAppStore((s) => s.hydrated);

  useEffect(() => {
    hydrate();
    registerForNotificationsStub();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) connect();
  }, [hydrated, connect]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="devices" options={{ title: "Devices" }} />
        <Stack.Screen name="device/[deviceId]" options={{ title: "New Task" }} />
        <Stack.Screen name="task/[taskId]" options={{ title: "Task" }} />
        <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
