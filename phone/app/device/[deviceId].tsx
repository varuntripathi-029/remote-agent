import { useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { ErrorBanner } from "../../src/components/ErrorBanner";
import { useAppStore } from "../../src/store/useAppStore";
import { colors } from "../../src/theme";
import { AGENT_OPTIONS } from "../../src/types/protocol";

export default function DeviceScreen() {
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const selectDevice = useAppStore((s) => s.selectDevice);
  const projectsByDevice = useAppStore((s) => s.projectsByDevice);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedAgent = useAppStore((s) => s.selectedAgent);
  const prompt = useAppStore((s) => s.prompt);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const startTask = useAppStore((s) => s.startTask);

  useEffect(() => {
    if (deviceId) selectDevice(deviceId);
  }, [deviceId, selectDevice]);

  const projects = projectsByDevice[deviceId] ?? [];

  const handleStart = () => {
    const taskId = startTask();
    if (taskId) router.push(`/task/${taskId}`);
  };

  const canStart = Boolean(selectedProjectId) && prompt.trim().length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <ErrorBanner />

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
        projects.map((project) => (
          <Pressable
            key={project.project_id}
            style={[
              styles.projectRow,
              selectedProjectId === project.project_id && styles.projectRowActive,
            ]}
            onPress={() => selectProject(project.project_id)}
          >
            <Text style={styles.projectName}>{project.display_name}</Text>
            {project.current_branch ? (
              <Text style={styles.projectMeta}>
                {project.current_branch}
                {project.last_commit_hash ? ` · ${project.last_commit_hash.slice(0, 7)}` : ""}
              </Text>
            ) : null}
          </Pressable>
        ))
      )}

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
  projectRowActive: { borderColor: colors.accent },
  projectName: { color: colors.text, fontSize: 16, fontWeight: "500" },
  projectMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
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
