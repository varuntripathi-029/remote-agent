import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { loginWithGithub } from "../src/auth/github";
import { buildHttpUrl, useAppStore } from "../src/store/useAppStore";
import { colors } from "../src/theme";

/**
 * GitHub OAuth login, per aim.md §2/§4: GitHub identifies the human, and
 * the JWT the backend issues at the end of that flow (see backend/auth.py)
 * is what actually authenticates every phone→backend request from here on
 * — `phone_id` below remains just a WebSocket routing handle, same as
 * before, not an identity.
 */
export default function LoginScreen() {
  const jwt = useAppStore((s) => s.jwt);
  const hydrated = useAppStore((s) => s.hydrated);
  const backendHost = useAppStore((s) => s.backendHost);
  const login = useAppStore((s) => s.login);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already logged in (e.g. app relaunch with a still-valid stored token) —
  // skip straight past the login screen.
  useEffect(() => {
    if (hydrated && jwt) {
      router.replace("/devices");
    }
  }, [hydrated, jwt]);

  const handleSignIn = async () => {
    setError(null);
    setSigningIn(true);
    try {
      const result = await loginWithGithub(buildHttpUrl(backendHost));
      if ("token" in result) {
        await login(result.token);
        router.replace("/devices");
      } else if (result.error !== "cancelled") {
        setError(result.error);
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DevAgent Remote</Text>
      <Text style={styles.subtitle}>Control your CLI coding agents from your phone.</Text>

      <Pressable
        style={[styles.button, signingIn && styles.disabled]}
        onPress={handleSignIn}
        disabled={signingIn}
      >
        {signingIn ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign in with GitHub</Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.meta}>backend: {backendHost}</Text>

      <Pressable onPress={() => router.push("/settings")}>
        <Text style={styles.link}>Backend settings</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/help")}>
        <Text style={styles.link}>Setup guide</Text>
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
  disabled: { opacity: 0.6 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 16 },
  meta: { color: colors.muted, fontSize: 12 },
  link: { color: colors.accent, fontSize: 14, marginTop: 16 },
});
