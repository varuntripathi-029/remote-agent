import { useEffect } from "react";
import { router, Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { completePendingAuthSession } from "../src/auth/github";
import { colors } from "../src/theme";
import { useAppStore } from "../src/store/useAppStore";
import { registerForNotificationsStub } from "../src/notifications";

export default function RootLayout() {
  const hydrate = useAppStore((s) => s.hydrate);
  const connect = useAppStore((s) => s.connect);
  const hydrated = useAppStore((s) => s.hydrated);
  const jwt = useAppStore((s) => s.jwt);

  useEffect(() => {
    hydrate();
    registerForNotificationsStub();
    completePendingAuthSession();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) connect();
  }, [hydrated, connect]);

  // Logout, or an "unauthorized" error clearing a bad/expired token (see
  // useAppStore.ts's handleIncoming), both just clear `jwt` — this is the
  // one place that reacts by actually navigating back to login, regardless
  // of which screen the user happened to be on when it happened.
  useEffect(() => {
    if (hydrated && !jwt) {
      router.replace("/");
    }
  }, [hydrated, jwt]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
          animation: "none",
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="devices" options={{ title: "Devices" }} />
        <Stack.Screen name="device/[deviceId]" options={{ title: "New Task" }} />
        <Stack.Screen name="task/[taskId]" options={{ title: "Task" }} />
        <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
        <Stack.Screen name="help" options={{ title: "Setup Guide", presentation: "modal" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
