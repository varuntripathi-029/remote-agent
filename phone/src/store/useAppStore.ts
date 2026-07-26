import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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

export type ProjectRegistration = { status: "pending" } | { status: "error"; error: string };

const PHONE_ID_KEY = "devagent.phoneId";
const BACKEND_HOST_KEY = "devagent.backendHost";
// Chat transcripts, session ids, and task results, persisted to the phone's
// own local storage only — never sent to the backend or devagent, and never
// synced to any cloud. See the persist() config below for exactly what's
// saved (partialize).
const CHAT_HISTORY_KEY = "devagent.chatHistory";

// EXPO_PUBLIC_* env vars are inlined at build time by Expo (see .env.example).
// Expo Go runs on the phone itself, so "localhost" here would mean the
// phone, not your PC — this must be the PC's LAN IP, e.g. "192.168.1.23:8000".
const DEFAULT_BACKEND_HOST = process.env.EXPO_PUBLIC_BACKEND_HOST || "192.168.1.100:8000";

export type LogEntry = { seq: number } & FormattedLog;
export type RevertStatus = "idle" | "pending" | "done" | "error";

interface TaskMeta {
  deviceId: string;
  projectId: string;
  agent: string;
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

  // Per-task device/project/agent, recorded for every task ever started (not
  // just the latest one) so revertTask/replyToTask work on any task screen,
  // not only the most recently started task.
  taskMetaById: Record<string, TaskMeta>;
  // The most recently started task_id — only used to attribute a top-level
  // backend "error" (which carries no task_id) to a pending revert.
  lastStartedTaskId: string | null;
  // Most recent task_id per project_id, so the device screen can reopen a
  // project's ongoing chat (its /task/[taskId] screen) after the app
  // restarts, instead of the transcript being persisted but unreachable.
  lastTaskIdByProject: Record<string, string>;
  // Keyed by project_id (not task_id) so the transcript — including the
  // user's own messages — persists across a whole chat's turns/tasks; only
  // startFresh() resets it.
  logsByProject: Record<string, LogEntry[]>;
  resultByTask: Record<string, TaskResultMessage>;
  pendingApprovalByTask: Record<string, ApprovalRequestMessage | undefined>;
  revertStatusByTask: Record<string, RevertStatus>;
  // Last session_id per project_id, so a follow-up task.start for the same
  // project continues that conversation by default (see docs/PROTOCOL.md).
  sessionIdByProject: Record<string, string>;
  // In-flight/failed project.register requests, keyed by req_id; a
  // successful one is removed once merged into projectsByDevice.
  projectRegistrationByReqId: Record<string, ProjectRegistration>;

  lastError: ErrorMessage | null;

  hydrate: () => Promise<void>;
  connect: () => void;
  setBackendHost: (host: string) => Promise<void>;

  selectDevice: (deviceId: string) => void;
  refreshProjects: (deviceId: string) => void;
  registerProject: (deviceId: string, displayName: string, localPath: string) => string;
  dismissProjectRegistration: (reqId: string) => void;
  selectAgent: (agent: string) => void;
  selectProject: (projectId: string) => void;
  setPrompt: (text: string) => void;

  startTask: () => string | null;
  replyToTask: (taskId: string, prompt: string) => string | null;
  startFresh: (projectId: string) => void;
  respondApproval: (taskId: string, reqId: string, allow: boolean) => void;
  revertTask: (taskId: string) => void;

  dismissError: () => void;
}

let client: PhoneSocketClient | null = null;
let logSeq = 0;

function buildWsUrl(host: string): string {
  return `ws://${host}/ws/phone`;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
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

  taskMetaById: {},
  lastStartedTaskId: null,
  lastTaskIdByProject: {},
  logsByProject: {},
  resultByTask: {},
  pendingApprovalByTask: {},
  revertStatusByTask: {},
  sessionIdByProject: {},
  projectRegistrationByReqId: {},

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

    // Chat history (logsByProject etc.) is loaded separately by the
    // persist() middleware below (skipHydration: true up top, so it's
    // triggered here rather than racing this hydrate()).
    await useAppStore.persist.rehydrate();

    // Restored log entries carry their own `seq`; keep the in-memory
    // counter past the highest one so newly appended entries never collide
    // with a restored key in FlatList's keyExtractor.
    let maxSeq = -1;
    for (const entries of Object.values(get().logsByProject)) {
      for (const entry of entries) maxSeq = Math.max(maxSeq, entry.seq);
    }
    logSeq = maxSeq + 1;

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

  // Re-ask a device for its registered projects without resetting the
  // current selection.
  refreshProjects: (deviceId: string) => {
    client?.send({ type: "projects.list", device_id: deviceId });
  },

  // Register a new project directly from the phone (see docs/PROTOCOL.md's
  // project.register) — devagent validates displayName/localPath (real
  // directory, real git repo) before it's added to its allowlist, same as
  // manage_projects.py. Returns the req_id so the caller can watch
  // projectRegistrationByReqId for the outcome.
  registerProject: (deviceId: string, displayName: string, localPath: string) => {
    const reqId = generateId("reg");
    client?.send({
      type: "project.register",
      req_id: reqId,
      device_id: deviceId,
      display_name: displayName,
      local_path: localPath,
    });
    set((state) => ({
      projectRegistrationByReqId: {
        ...state.projectRegistrationByReqId,
        [reqId]: { status: "pending" },
      },
    }));
    return reqId;
  },

  dismissProjectRegistration: (reqId: string) => {
    set((state) => ({
      projectRegistrationByReqId: omit(state.projectRegistrationByReqId, reqId),
    }));
  },

  selectAgent: (agent: string) => set({ selectedAgent: agent }),
  selectProject: (projectId: string) => set({ selectedProjectId: projectId }),
  setPrompt: (text: string) => set({ prompt: text }),

  startTask: () => {
    const { selectedDeviceId, selectedProjectId, selectedAgent, prompt } = get();
    if (!selectedDeviceId || !selectedProjectId || !prompt.trim()) {
      return null;
    }
    const taskId = dispatchTask(
      set,
      get,
      selectedDeviceId,
      selectedProjectId,
      selectedAgent,
      prompt.trim(),
    );
    set({ prompt: "" });
    return taskId;
  },

  // Continue an existing task's conversation (e.g. answering a clarifying
  // question) as a new task using the same device/project/agent — and,
  // because sessionIdByProject still has that project's session_id cached,
  // dispatchTask automatically resumes it instead of starting fresh.
  replyToTask: (taskId: string, prompt: string) => {
    const meta = get().taskMetaById[taskId];
    const trimmed = prompt.trim();
    if (!meta || !trimmed) return null;
    return dispatchTask(set, get, meta.deviceId, meta.projectId, meta.agent, trimmed);
  },

  // Forget the cached conversation (and visible transcript) for a project so
  // the next startTask()/replyToTask() begins a brand new one instead of
  // continuing the last task's.
  startFresh: (projectId: string) => {
    set((state) => ({
      sessionIdByProject: omit(state.sessionIdByProject, projectId),
      logsByProject: omit(state.logsByProject, projectId),
      lastTaskIdByProject: omit(state.lastTaskIdByProject, projectId),
    }));
  },

  respondApproval: (taskId: string, reqId: string, allow: boolean) => {
    client?.send({ type: "approval.response", req_id: reqId, allow });
    set((state) => ({
      pendingApprovalByTask: { ...state.pendingApprovalByTask, [taskId]: undefined },
    }));
  },

  revertTask: (taskId: string) => {
    const { taskMetaById, resultByTask } = get();
    const meta = taskMetaById[taskId];
    const result = resultByTask[taskId];
    if (!meta || !result) return;

    client?.send({
      type: "task.revert",
      task_id: taskId,
      device_id: meta.deviceId,
      project_id: meta.projectId,
      checkpoint: result.checkpoint,
    });
    set((state) => ({
      revertStatusByTask: { ...state.revertStatusByTask, [taskId]: "pending" },
    }));
  },

  dismissError: () => set({ lastError: null }),
    }),
    {
      name: CHAT_HISTORY_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // hydrate() above calls useAppStore.persist.rehydrate() explicitly so
      // it can finish before `hydrated` flips true (see _layout.tsx, which
      // gates connect() on that) — skip the middleware's own automatic
      // rehydration-on-store-creation.
      skipHydration: true,
      // Only the chat itself is phone-local persisted state; connection
      // status, drafts, and in-flight approval/revert UI state should
      // always start fresh on app launch, not resume mid-flight.
      partialize: (state) => ({
        taskMetaById: state.taskMetaById,
        lastTaskIdByProject: state.lastTaskIdByProject,
        logsByProject: state.logsByProject,
        resultByTask: state.resultByTask,
        sessionIdByProject: state.sessionIdByProject,
      }),
    },
  ),
);

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _drop, ...rest } = obj;
  return rest as T;
}

// Shared by startTask/replyToTask: sends task.start (auto-attaching
// resume_session_id when this project has a cached conversation) and seeds
// this new task_id's bookkeeping.
function dispatchTask(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  deviceId: string,
  projectId: string,
  agent: string,
  prompt: string,
): string {
  const taskId = generateId("task");
  const resumeSessionId = get().sessionIdByProject[projectId];
  client?.send({
    type: "task.start",
    task_id: taskId,
    device_id: deviceId,
    agent,
    project_id: projectId,
    prompt,
    ...(resumeSessionId ? { resume_session_id: resumeSessionId } : {}),
  });

  const userEntry: LogEntry = { seq: logSeq++, text: `› ${prompt}`, variant: "user" };

  set((state) => ({
    taskMetaById: { ...state.taskMetaById, [taskId]: { deviceId, projectId, agent } },
    lastStartedTaskId: taskId,
    lastTaskIdByProject: { ...state.lastTaskIdByProject, [projectId]: taskId },
    logsByProject: {
      ...state.logsByProject,
      [projectId]: [...(state.logsByProject[projectId] ?? []), userEntry],
    },
    resultByTask: omit(state.resultByTask, taskId),
    pendingApprovalByTask: omit(state.pendingApprovalByTask, taskId),
    revertStatusByTask: { ...state.revertStatusByTask, [taskId]: "idle" },
  }));

  return taskId;
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
      const meta = get().taskMetaById[message.task_id];
      if (meta) {
        const entry: LogEntry = { seq: logSeq++, ...formatLog(message.data) };
        set((state) => ({
          logsByProject: {
            ...state.logsByProject,
            [meta.projectId]: [...(state.logsByProject[meta.projectId] ?? []), entry],
          },
        }));
      }

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

    case "task.result": {
      const meta = get().taskMetaById[message.task_id];
      set((state) => ({
        resultByTask: { ...state.resultByTask, [message.task_id]: message },
        sessionIdByProject:
          meta && message.session_id
            ? { ...state.sessionIdByProject, [meta.projectId]: message.session_id }
            : state.sessionIdByProject,
      }));
      return;
    }

    case "error": {
      // Top-level backend errors (bad_message/device_offline) — a revert's
      // own failure is a devagent-level "log" event instead, handled above.
      set({ lastError: message });
      const { lastStartedTaskId, revertStatusByTask } = get();
      if (lastStartedTaskId && revertStatusByTask[lastStartedTaskId] === "pending") {
        set((state) => ({
          revertStatusByTask: { ...state.revertStatusByTask, [lastStartedTaskId]: "error" },
        }));
      }
      return;
    }

    case "project.register.result": {
      set((state) => ({
        projectRegistrationByReqId: message.ok
          ? omit(state.projectRegistrationByReqId, message.req_id)
          : {
              ...state.projectRegistrationByReqId,
              [message.req_id]: { status: "error", error: message.error ?? "registration failed" },
            },
        projectsByDevice:
          message.ok && message.project
            ? {
                ...state.projectsByDevice,
                [message.device_id]: [
                  ...(state.projectsByDevice[message.device_id] ?? []),
                  message.project,
                ],
              }
            : state.projectsByDevice,
      }));
      return;
    }
  }
}
