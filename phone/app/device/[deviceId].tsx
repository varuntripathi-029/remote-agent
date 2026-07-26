import { useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";

import { ErrorBanner } from "../../src/components/ErrorBanner";
import { ProjectDrawer } from "../../src/components/ProjectDrawer";
import { useAppStore } from "../../src/store/useAppStore";
import { colors } from "../../src/theme";
import { AGENT_OPTIONS } from "../../src/types/protocol";

export default function DeviceScreen() {
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const navigation = useNavigation();
  const selectDevice = useAppStore((s) => s.selectDevice);
  const projectsByDevice = useAppStore((s) => s.projectsByDevice);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedAgent = useAppStore((s) => s.selectedAgent);
  const prompt = useAppStore((s) => s.prompt);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const startTask = useAppStore((s) => s.startTask);
  const sessionIdByProject = useAppStore((s) => s.sessionIdByProject);
  const startFresh = useAppStore((s) => s.startFresh);
  const logsByProject = useAppStore((s) => s.logsByProject);
  const lastTaskIdByProject = useAppStore((s) => s.lastTaskIdByProject);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (deviceId) selectDevice(deviceId);
  }, [deviceId, selectDevice]);

  useLayoutEffect(() => {
    // navigation.setOptions({ headerLeft }) replaces the native back button
    // entirely, so re-render it alongside the hamburger rather than losing
    // the way back to the Devices list.
    navigation.setOptions({
      headerLeft: () => (
        <View style={styles.headerLeftRow}>
          {navigation.canGoBack() ? (
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <Text style={styles.backArrow}>‹</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setDrawerOpen(true)} hitSlop={12}>
            <Text style={styles.hamburger}>☰</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation]);

  const projects = projectsByDevice[deviceId] ?? [];
  const selectedProject = projects.find((p) => p.project_id === selectedProjectId);

  const handleStart = () => {
    const taskId = startTask();
    if (taskId) router.push(`/task/${taskId}`);
  };

  const canStart = Boolean(selectedProjectId) && prompt.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <ErrorBanner />

      <ProjectDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        deviceId={deviceId}
        onSelectProject={selectProject}
      />

      <Text style={styles.label}>Device</Text>
      <Text style={styles.deviceId}>{deviceId}</Text>

      <Text style={styles.label}>Agent</Text>
      <View style={styles.chipRow}>
        {AGENT_OPTIONS.map((agent) => (
          <Pressable
            key={agent}
            style={[styles.chip, selectedAgent === agent && styles.chipActive]}
            onPress={() => selectAgent(agent)}
          >
            <Text style={[styles.chipText, selectedAgent === agent && styles.chipTextActive]}>
              {agent}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Project</Text>
      {projects.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.muted} />
          <Text style={styles.muted}>Loading projects…</Text>
        </View>
      ) : (
        <Pressable style={styles.projectRow} onPress={() => setDrawerOpen(true)}>
          {selectedProject ? (
            <>
              <Text style={styles.projectName}>{selectedProject.display_name}</Text>
              {selectedProject.current_branch ? (
                <Text style={styles.projectMeta}>
                  {selectedProject.current_branch}
                  {selectedProject.last_commit_hash
                    ? ` · ${selectedProject.last_commit_hash.slice(0, 7)}`
                    : ""}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>Tap ☰ or here to pick a project…</Text>
          )}
        </Pressable>
      )}

      {selectedProjectId && logsByProject[selectedProjectId]?.length ? (
        <View style={styles.continuingRow}>
          <Pressable
            onPress={() => router.push(`/task/${lastTaskIdByProject[selectedProjectId]}`)}
            disabled={!lastTaskIdByProject[selectedProjectId]}
          >
            <Text style={styles.continuingText}>
              {sessionIdByProject[selectedProjectId] ? "Continuing previous conversation — " : ""}
              <Text style={styles.startFreshLink}>View chat history</Text>
            </Text>
          </Pressable>
          <Pressable onPress={() => startFresh(selectedProjectId)}>
            <Text style={styles.startFreshLink}>Start fresh</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.label}>Prompt</Text>
      <TextInput
        style={styles.promptInput}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Describe the change you want…"
        placeholderTextColor={colors.muted}
        multiline
      />

      <Pressable
        style={[styles.startButton, !canStart && styles.disabled]}
        disabled={!canStart}
        onPress={handleStart}
      >
        <Text style={styles.startButtonText}>Start Task</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  label: {
    color: colors.muted,
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 8,
  },
  deviceId: { color: colors.text, fontSize: 18, fontWeight: "600" },
  headerLeftRow: { flexDirection: "row", alignItems: "center", gap: 16, marginRight: 16 },
  backArrow: { color: colors.text, fontSize: 28, marginTop: -2 },
  hamburger: { color: colors.text, fontSize: 22 },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  muted: { color: colors.muted },
  projectRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectName: { color: colors.text, fontSize: 16, fontWeight: "500" },
  projectMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  continuingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
  },
  continuingText: { color: colors.muted, fontSize: 12 },
  startFreshLink: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  promptInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: 14,
    minHeight: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
  },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 40,
  },
  disabled: { opacity: 0.4 },
  startButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
