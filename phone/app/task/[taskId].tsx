import { useEffect, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { ErrorBanner } from "../../src/components/ErrorBanner";
import { LogEntry, useAppStore } from "../../src/store/useAppStore";
import { colors } from "../../src/theme";

export default function TaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const logs = useAppStore((s) => s.logsByTask[taskId] ?? []);
  const result = useAppStore((s) => s.resultByTask[taskId]);
  const approval = useAppStore((s) => s.pendingApprovalByTask[taskId]);
  const revertStatus = useAppStore((s) => s.revertStatusByTask[taskId] ?? "idle");
  const respondApproval = useAppStore((s) => s.respondApproval);
  const revertTask = useAppStore((s) => s.revertTask);
  const listRef = useRef<FlatList<LogEntry>>(null);

  useEffect(() => {
    if (logs.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [logs.length]);

  return (
    <View style={styles.container}>
      <ErrorBanner />

      <FlatList
        ref={listRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
        data={logs}
        keyExtractor={(entry) => String(entry.seq)}
        renderItem={({ item }) => (
          <Text style={[styles.logLine, variantStyle(item.variant)]}>{item.text}</Text>
        )}
        ListEmptyComponent={<Text style={styles.muted}>Waiting for output…</Text>}
      />

      {approval ? (
        <View style={styles.approvalBar}>
          <Text style={styles.approvalTitle}>Approve tool call: {approval.tool}</Text>
          <Text style={styles.approvalInput} numberOfLines={3}>
            {JSON.stringify(approval.input)}
          </Text>
          <View style={styles.approvalButtons}>
            <Pressable
              style={[styles.approvalButton, styles.denyButton]}
              onPress={() => respondApproval(taskId, approval.req_id, false)}
            >
              <Text style={styles.approvalButtonText}>Deny</Text>
            </Pressable>
            <Pressable
              style={[styles.approvalButton, styles.allowButton]}
              onPress={() => respondApproval(taskId, approval.req_id, true)}
            >
              <Text style={styles.approvalButtonText}>Approve</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {result ? (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>
            {result.files.length} file{result.files.length === 1 ? "" : "s"} changed ·{" "}
            <Text style={styles.insertions}>+{result.stat.insertions}</Text>{" "}
            <Text style={styles.deletions}>-{result.stat.deletions}</Text>
          </Text>
          {result.files.map((file) => (
            <Text key={file} style={styles.resultFile}>
              {file}
            </Text>
          ))}
          <Text style={styles.checkpoint}>checkpoint {result.checkpoint.slice(0, 12)}</Text>

          <Pressable
            style={[
              styles.revertButton,
              (revertStatus === "pending" || revertStatus === "done") && styles.disabled,
            ]}
            disabled={revertStatus === "pending" || revertStatus === "done"}
            onPress={() => revertTask(taskId)}
          >
            <Text style={styles.revertButtonText}>
              {revertStatus === "pending"
                ? "Reverting…"
                : revertStatus === "done"
                  ? "Reverted"
                  : revertStatus === "error"
                    ? "Revert failed — retry"
                    : "Revert"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function variantStyle(variant: LogEntry["variant"]) {
  switch (variant) {
    case "success":
      return { color: colors.success };
    case "error":
      return { color: colors.danger };
    case "muted":
      return { color: colors.muted };
    default:
      return { color: colors.text };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  terminal: { flex: 1, backgroundColor: "#05080b" },
  terminalContent: { padding: 12 },
  logLine: { fontFamily: "monospace", fontSize: 12, marginBottom: 4 },
  muted: { color: colors.muted, padding: 16 },
  approvalBar: { backgroundColor: colors.warning, padding: 14 },
  approvalTitle: { color: "#1a1300", fontWeight: "700", fontSize: 14 },
  approvalInput: { color: "#1a1300", fontSize: 12, marginTop: 4, fontFamily: "monospace" },
  approvalButtons: { flexDirection: "row", gap: 10, marginTop: 10 },
  approvalButton: { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  denyButton: { backgroundColor: colors.danger },
  allowButton: { backgroundColor: colors.success },
  approvalButtonText: { color: "#fff", fontWeight: "600" },
  resultCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resultTitle: { color: colors.text, fontSize: 14, fontWeight: "600", marginBottom: 6 },
  insertions: { color: colors.success },
  deletions: { color: colors.danger },
  resultFile: { color: colors.muted, fontSize: 12, fontFamily: "monospace" },
  checkpoint: { color: colors.muted, fontSize: 11, marginTop: 8 },
  revertButton: {
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  revertButtonText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
});
