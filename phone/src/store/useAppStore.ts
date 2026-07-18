import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { formatLog, type FormattedLog } from "../util/formatLog";
import { generateId } from "../util/id";
import { ConnectionStatus, PhoneSocketClient } from "../ws/client";
import type {
  ApprovalRequestMessage,
  ErrorMessage,
  PhoneIncomingMessage,
  ProjectSummary,
  TaskResultMessage,
} from "../types/protocol";

const PHONE_ID_KEY = "devagent.phoneId";
const BACKEND_HOST_KEY = "devagent.backendHost";

// EXPO_PUBLIC_* env vars are inlined at build time by Expo (see .env.example).
// Expo Go runs on the phone itself, so "localhost" here would mean the
// phone, not your PC — this must be the PC's LAN IP, e.g. "192.168.1.23:8000".
const DEFAULT_BACKEND_HOST = process.env.EXPO_PUBLIC_BACKEND_HOST || "192.168.1.100:8000";

export type LogEntry = { seq: number } & FormattedLog;
export type RevertStatus = "idle" | "pending" | "done" | "error";

interface ActiveTask {
  taskId: string;
  deviceId: string;
  projectId: string;
}

interface AppState {
  hydrated: boolean;
  phoneId: string;
  backendHost: string;
  connectionStatus: ConnectionStatus;

  devices: string[];
  projectsByDevice: Record<string, ProjectSummary[]>;

  selectedDeviceId: string | null;
  selectedProjectId: string | null;
  selectedAgent: string;
  prompt: string;

  activeTask: ActiveTask | null;
  logsByTask: Record<string, LogEntry[]>;
  resultByTask: Record<string, TaskResultMessage>;
  pendingApprovalByTask: Record<string, ApprovalRequestMessage | undefined>;
  revertStatusByTask: Record<string, RevertStatus>;

  lastError: ErrorMessage | null;

  hydrate: () => Promise<void>;
  connect: () => void;
  setBackendHost: (host: string) => Promise<void>;

  selectDevice: (deviceId: string) => void;
  selectAgent: (agent: string) => void;
  selectProject: (projectId: string) => void;
  setPrompt: (text: string) => void;

  startTask: () => string | null;
  respondApproval: (taskId: string, reqId: string, allow: boolean) => void;
  revertTask: (taskId: string) => void;

  dismissError: () => void;
}

let client: PhoneSocketClient | null = null;
let logSeq = 0;

function buildWsUrl(host: string): string {
  return `ws://${host}/ws/phone`;
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  phoneId: "",
  backendHost: DEFAULT_BACKEND_HOST,
  connectionStatus: "disconnected",

  devices: [],
  projectsByDevice: {},

  selectedDeviceId: null,
  selectedProjectId: null,
  selectedAgent: "claude",
  prompt: "",

  activeTask: null,
  logsByTask: {},
  resultByTask: {},
  pendingApprovalByTask: {},
  revertStatusByTask: {},

  lastError: null,

  hydrate: async () => {
    let [phoneId, backendHost] = await Promise.all([
      AsyncStorage.getItem(PHONE_ID_KEY),
      AsyncStorage.getItem(BACKEND_HOST_KEY),
    ]);

    if (!phoneId) {
      phoneId = generateId("phone");
      await AsyncStorage.setItem(PHONE_ID_KEY, phoneId);
    }

    set({
      phoneId,
      backendHost: backendHost || DEFAULT_BACKEND_HOST,
      hydrated: true,
    });
  },

  connect: () => {
    const { phoneId, backendHost } = get();
    client?.disconnect();

    client = new PhoneSocketClient(buildWsUrl(backendHost), phoneId, {
      onStatus: (status) => set({ connectionStatus: status }),
      onMessage: (message) => handleIncoming(message, set, get),
    });
    client.connect();
  },

  setBackendHost: async (host: string) => {
    await AsyncStorage.setItem(BACKEND_HOST_KEY, host);
    set({ backendHost: host, devices: [], projectsByDevice: {} });
    get().connect();
  },

  selectDevice: (deviceId: string) => {
    set({ selectedDeviceId: deviceId, selectedProjectId: null });
    client?.send({ type: "projects.list", device_id: deviceId });
  },

  selectAgent: (agent: string) => set({ selectedAgent: agent }),
  selectProject: (projectId: string) => set({ selectedProjectId: projectId }),
  setPrompt: (text: string) => set({ prompt: text }),

  startTask: () => {
    const { selectedDeviceId, selectedProjectId, selectedAgent, prompt } = get();
    if (!selectedDeviceId || !selectedProjectId || !prompt.trim()) {
      return null;
    }

    const taskId = generateId("task");
    client?.send({
      type: "task.start",
      task_id: taskId,
      device_id: selectedDeviceId,
      agent: selectedAgent,
      project_id: selectedProjectId,
      prompt: prompt.trim(),
    });

    set((state) => ({
      activeTask: { taskId, deviceId: selectedDeviceId, projectId: selectedProjectId },
      logsByTask: { ...state.logsByTask, [taskId]: [] },
      resultByTask: omit(state.resultByTask, taskId),
      pendingApprovalByTask: omit(state.pendingApprovalByTask, taskId),
      revertStatusByTask: { ...state.revertStatusByTask, [taskId]: "idle" },
      prompt: "",
    }));

    return taskId;
  },

  respondApproval: (taskId: string, reqId: string, allow: boolean) => {
    client?.send({ type: "approval.response", req_id: reqId, allow });
    set((state) => ({
      pendingApprovalByTask: { ...state.pendingApprovalByTask, [taskId]: undefined },
    }));
  },

  revertTask: (taskId: string) => {
    const { activeTask, resultByTask } = get();
    const result = resultByTask[taskId];
    if (!activeTask || activeTask.taskId !== taskId || !result) return;

    client?.send({
      type: "task.revert",
      task_id: taskId,
      device_id: activeTask.deviceId,
      project_id: activeTask.projectId,
      checkpoint: result.checkpoint,
    });
    set((state) => ({
      revertStatusByTask: { ...state.revertStatusByTask, [taskId]: "pending" },
    }));
  },

  dismissError: () => set({ lastError: null }),
}));

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _drop, ...rest } = obj;
  return rest as T;
}

function handleIncoming(
  message: PhoneIncomingMessage,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): void {
  switch (message.type) {
    case "devices":
      set({ devices: message.online });
      return;

    case "projects":
      set((state) => ({
        projectsByDevice: { ...state.projectsByDevice, [message.device_id]: message.projects },
      }));
      return;

    case "log": {
      const entry: LogEntry = { seq: logSeq++, ...formatLog(message.data) };
      set((state) => ({
        logsByTask: {
          ...state.logsByTask,
          [message.task_id]: [...(state.logsByTask[message.task_id] ?? []), entry],
        },
      }));

      // A revert's outcome arrives as a devagent-level log event (see
      // devagent/main.py _handle_task_revert), not a distinct top-level
      // message — only update revert status if one is actually pending, so
      // an unrelated task-run error doesn't get misread as a revert failure.
      const pendingRevert = get().revertStatusByTask[message.task_id] === "pending";
      if (pendingRevert && message.data.kind === "revert") {
        set((state) => ({
          revertStatusByTask: { ...state.revertStatusByTask, [message.task_id]: "done" },
        }));
      } else if (pendingRevert && message.data.kind === "error") {
        set((state) => ({
          revertStatusByTask: { ...state.revertStatusByTask, [message.task_id]: "error" },
        }));
      }
      return;
    }

    case "approval.request":
      set((state) => ({
        pendingApprovalByTask: { ...state.pendingApprovalByTask, [message.task_id]: message },
      }));
      return;

    case "task.result":
      set((state) => ({
        resultByTask: { ...state.resultByTask, [message.task_id]: message },
      }));
      return;

    case "error": {
      // Top-level backend errors (bad_message/device_offline) — a revert's
      // own failure is a devagent-level "log" event instead, handled above.
      set({ lastError: message });
      const { activeTask, revertStatusByTask } = get();
      if (activeTask && revertStatusByTask[activeTask.taskId] === "pending") {
        set((state) => ({
          revertStatusByTask: { ...state.revertStatusByTask, [activeTask.taskId]: "error" },
        }));
      }
      return;
    }
  }
}
