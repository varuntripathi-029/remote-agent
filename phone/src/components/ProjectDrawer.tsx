import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAppStore } from "../store/useAppStore";
import { colors } from "../theme";

interface ProjectDrawerProps {
  visible: boolean;
  onClose: () => void;
  deviceId: string;
  /** Called with the tapped project's project_id. The drawer always closes
   * itself first; screens decide whether that also means navigating. */
  onSelectProject: (projectId: string) => void;
}

/** Left-side sidebar for picking or registering a project on `deviceId`.
 * Registration (see docs/PROTOCOL.md's project.register) runs the request
 * straight from the phone — the devagent still validates the path (real
 * directory, real git repo, resolved to the repo root) before adding it to
 * its allowlist, same as manage_projects.py; only the trigger moved. */
export function ProjectDrawer({ visible, onClose, deviceId, onSelectProject }: ProjectDrawerProps) {
  const projects = useAppStore((s) => s.projectsByDevice[deviceId]) ?? [];
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const registerProject = useAppStore((s) => s.registerProject);
  const dismissProjectRegistration = useAppStore((s) => s.dismissProjectRegistration);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [reqId, setReqId] = useState<string | null>(null);
  const registration = useAppStore((s) =>
    reqId ? s.projectRegistrationByReqId[reqId] : undefined,
  );

  const handleSelect = (projectId: string) => {
    onSelectProject(projectId);
    onClose();
  };

  const handleRegister = () => {
    if (!name.trim() || !path.trim()) return;
    const id = registerProject(deviceId, name.trim(), path.trim());
    setReqId(id);
  };

  // A successful registration removes its entry from
  // projectRegistrationByReqId (see useAppStore) — once that happens, clear
  // the form so the drawer is ready for the next one.
  useEffect(() => {
    if (reqId && registration === undefined) {
      setName("");
      setPath("");
      setShowAddForm(false);
      setReqId(null);
    }
  }, [reqId, registration]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.panel}>
          <Text style={styles.title}>Projects</Text>
          <Text style={styles.deviceLabel}>{deviceId}</Text>

          <ScrollView style={styles.list}>
            {projects.length === 0 ? (
              <Text style={styles.muted}>No projects registered on this device yet.</Text>
            ) : (
              projects.map((project) => (
                <Pressable
                  key={project.project_id}
                  style={[
                    styles.projectRow,
                    selectedProjectId === project.project_id && styles.projectRowActive,
                  ]}
                  onPress={() => handleSelect(project.project_id)}
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
          </ScrollView>

          <Pressable style={styles.addRow} onPress={() => setShowAddForm((v) => !v)}>
            <Text style={styles.addRowText}>{showAddForm ? "▾" : "▸"} + Add project</Text>
          </Pressable>

          {showAddForm ? (
            <View style={styles.addForm}>
              <Text style={styles.addFormLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="my-repo"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />

              <Text style={styles.addFormLabel}>Path (on the laptop, {deviceId})</Text>
              <TextInput
                style={styles.input}
                value={path}
                onChangeText={setPath}
                placeholder={"C:\\Users\\me\\projects\\my-repo"}
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {registration?.status === "error" ? (
                <Text style={styles.registerError}>{registration.error}</Text>
              ) : null}

              <Pressable
                style={[
                  styles.registerButton,
                  (!name.trim() || !path.trim() || registration?.status === "pending") &&
                    styles.disabled,
                ]}
                disabled={!name.trim() || !path.trim() || registration?.status === "pending"}
                onPress={handleRegister}
              >
                {registration?.status === "pending" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.registerButtonText}>Register project</Text>
                )}
              </Pressable>

              {registration?.status === "error" ? (
                <Pressable onPress={() => reqId && dismissProjectRegistration(reqId)}>
                  <Text style={styles.dismissLink}>Dismiss</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const PANEL_WIDTH = 280;

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: "row" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  panel: {
    width: PANEL_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  deviceLabel: { color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: 16 },
  list: { flexGrow: 0 },
  muted: { color: colors.muted, fontSize: 13 },
  projectRow: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectRowActive: { borderColor: colors.accent },
  projectName: { color: colors.text, fontSize: 15, fontWeight: "500" },
  projectMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  addRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 16,
  },
  addRowText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  addForm: { paddingBottom: 24 },
  addFormLabel: {
    color: colors.muted,
    fontSize: 11,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  registerError: { color: colors.danger, fontSize: 12, marginTop: 10 },
  registerButton: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 14,
  },
  registerButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  dismissLink: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8 },
  disabled: { opacity: 0.5 },
});
