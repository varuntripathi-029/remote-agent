import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBanner } from "../../src/components/ErrorBanner";
import { ProjectDrawer } from "../../src/components/ProjectDrawer";
import { LogEntry, useAppStore } from "../../src/store/useAppStore";
import { colors } from "../../src/theme";

export default function TaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const navigation = useNavigation();
  const meta = useAppStore((s) => s.taskMetaById[taskId]);
  const logs = useAppStore((s) => (meta ? s.logsByProject[meta.projectId] : undefined) ?? []);
  const result = useAppStore((s) => s.resultByTask[taskId]);
  const approval = useAppStore((s) => s.pendingApprovalByTask[taskId]);
  const revertStatus = useAppStore((s) => s.revertStatusByTask[taskId] ?? "idle");
  const respondApproval = useAppStore((s) => s.respondApproval);
  const revertTask = useAppStore((s) => s.revertTask);
  const replyToTask = useAppStore((s) => s.replyToTask);
  const selectProject = useAppStore((s) => s.selectProject);
  const listRef = useRef<FlatList<LogEntry>>(null);
  const [reply, setReply] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const insets = useSafeAreaInsets();
  // Approximate native stack header height (44pt on iOS) on top of the
  // safe-area inset, so "padding" behavior doesn't leave the reply row
  // hidden under the header before it starts pushing content up.
  const insetsTop = insets.top + 44;

  const handleReply = () => {
    const newTaskId = replyToTask(taskId, reply);
    if (newTaskId) {
      setReply("");
      // replace (not push): this is the same ongoing chat, just a new turn —
      // back should return straight to the device screen, not step through
      // one screen per turn.
      router.replace(`/task/${newTaskId}`);
    }
  };

  // Revert undoes a real git reset — confirm first since the button sits
  // right next to Send now and a misclick would otherwise be one tap away.
  const handleRevertPress = () => {
    Alert.alert(
      "Revert this task's changes?",
      "This rolls the project back to the checkpoint taken before this task ran.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Revert", style: "destructive", onPress: () => revertTask(taskId) },
      ],
    );
  };

  // Picking a different project here means "start a new task there", since
  // this screen is tied to the task that's already running/finished.
  const handleSelectProject = (projectId: string) => {
    selectProject(projectId);
    if (meta) router.replace(`/device/${meta.deviceId}`);
  };

  useEffect(() => {
    if (logs.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [logs.length]);

  useLayoutEffect(() => {
    // navigation.setOptions({ headerLeft }) replaces the native back button
    // entirely, so re-render it alongside the hamburger rather than losing
    // the way back to the device screen.
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insetsTop : 0}
    >
      <ErrorBanner />

      {meta ? (
        <ProjectDrawer
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          deviceId={meta.deviceId}
          onSelectProject={handleSelectProject}
        />
      ) : null}

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
          <Text style={styles.approvalInput} numberOfLines={4}>
            {formatApprovalInput(approval.input)}
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

          <View style={styles.replyRow}>
            <TextInput
              style={styles.replyInput}
              value={reply}
              onChangeText={setReply}
              placeholder="Reply to continue this conversation…"
              placeholderTextColor={colors.muted}
              multiline
            />
            <View style={styles.sideButtons}>
              <Pressable
                style={[
                  styles.revertButton,
                  (revertStatus === "pending" || revertStatus === "done") && styles.disabled,
                ]}
                disabled={revertStatus === "pending" || revertStatus === "done"}
                onPress={handleRevertPress}
                hitSlop={4}
              >
                <Text style={styles.revertButtonText}>
                  {revertStatus === "pending"
                    ? "…"
                    : revertStatus === "done"
                      ? "✓"
                      : revertStatus === "error"
                        ? "retry"
                        : "revert"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.replyButton, !reply.trim() && styles.disabled]}
                disabled={!reply.trim()}
                onPress={handleReply}
              >
                <Text style={styles.replyButtonText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function formatApprovalInput(input: Record<string, unknown>): string {
  // Bash calls are the common case — show the command directly instead of
  // a JSON blob; fall back to compact JSON for anything else.
  if (typeof input.command === "string") return input.command;
  return JSON.stringify(input);
}

function variantStyle(variant: LogEntry["variant"]) {
  switch (variant) {
    case "success":
      return { color: colors.success };
    case "error":
      return { color: colors.danger };
    case "muted":
      return { color: colors.muted };
    case "user":
      return { color: colors.accent, fontWeight: "700" as const };
    case "assistant":
      return { color: colors.assistant };
    case "tool":
      return { color: colors.tool };
    default:
      return { color: colors.text };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerLeftRow: { flexDirection: "row", alignItems: "center", gap: 16, marginRight: 16 },
  backArrow: { color: colors.text, fontSize: 28, marginTop: -2 },
  hamburger: { color: colors.text, fontSize: 22 },
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
  replyRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "flex-end" },
  replyInput: {
    flex: 1,
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 10,
    padding: 10,
    maxHeight: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Stacked so Revert is the same size as Send and sits directly above it —
  // small and out of the main tap path, instead of a full-width danger bar.
  sideButtons: { width: 64, gap: 6 },
  revertButton: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  revertButtonText: { color: "#fff", fontWeight: "600", fontSize: 12 },
  replyButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  replyButtonText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
});
