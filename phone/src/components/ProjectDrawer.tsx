import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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

/** Left-side sidebar for picking (or registering) a project on `deviceId`.
 * Registration itself stays laptop-only (see aim.md §5 — the backend must
 * never receive/store a local filesystem path), so "Add project" only shows
 * the CLI command to run there, plus a way to refresh once it's done. */
export function ProjectDrawer({ visible, onClose, deviceId, onSelectProject }: ProjectDrawerProps) {
  const projects = useAppStore((s) => s.projectsByDevice[deviceId]) ?? [];
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const [showAddInfo, setShowAddInfo] = useState(false);

  const handleSelect = (projectId: string) => {
    onSelectProject(projectId);
    onClose();
  };

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

          <Pressable style={styles.addRow} onPress={() => setShowAddInfo((v) => !v)}>
            <Text style={styles.addRowText}>{showAddInfo ? "▾" : "▸"} + Add project</Text>
          </Pressable>

          {showAddInfo ? (
            <View style={styles.addInfo}>
              <Text style={styles.addInfoText}>
                Projects are registered on the laptop, not the phone. In the devagent/ folder
                there, run:
              </Text>
              <Text style={styles.code}>
                python manage_projects.py add "&lt;name&gt;" "&lt;path&gt;"
              </Text>
              <Pressable style={styles.refreshButton} onPress={() => refreshProjects(deviceId)}>
                <Text style={styles.refreshButtonText}>Refresh projects</Text>
              </Pressable>
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
  addInfo: { paddingBottom: 24 },
  addInfoText: { color: colors.muted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
  code: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 11,
    backgroundColor: colors.bg,
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  refreshButton: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  refreshButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
