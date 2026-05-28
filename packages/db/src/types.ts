export type AutomationRunStatus = "running" | "completed" | "failed";

export interface StoredAutomationRecord {
  id: string;
  name: string;
  version: number;
  definition: unknown;
  profileId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAutomationRunRecord {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export interface StoredProfileRecord {
  id: string;
  name: string;
  systemPrompt: string;
  model: string | null;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredToolRecord {
  id: string;
  name: string;
  description: string;
  handlerType: string;
  handlerConfig: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSessionRecord {
  id: string;
  profileId: string;
  channel: string;
  createdAt: string;
}

export interface StoredSessionMessageRecord {
  id: string;
  sessionId: string;
  seq: number;
  payload: unknown;
  createdAt: string;
}

export interface StoredSessionSummaryRecord {
  id: string;
  profileId: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string | null;
}

export interface StoredTaskRecord {
  id: string;
  title: string;
  description: string;
  prompt: string;
  profileId: string;
  status: string;
  position: number;
  sessionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskRunStatus = "running" | "completed" | "failed";

export interface StoredTaskRunRecord {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export interface DatabaseAdapter {
  listAutomations(): Promise<StoredAutomationRecord[]>;
  getAutomation(id: string): Promise<StoredAutomationRecord | null>;
  upsertAutomation(record: StoredAutomationRecord): Promise<void>;
  deleteAutomation(id: string): Promise<boolean>;

  listAutomationRuns(automationId: string, limit?: number): Promise<StoredAutomationRunRecord[]>;
  getActiveAutomationRun(automationId: string): Promise<StoredAutomationRunRecord | null>;
  insertAutomationRun(record: StoredAutomationRunRecord): Promise<void>;
  updateAutomationRun(record: StoredAutomationRunRecord): Promise<void>;

  listProfiles(): Promise<StoredProfileRecord[]>;
  getProfile(id: string): Promise<StoredProfileRecord | null>;
  upsertProfile(record: StoredProfileRecord): Promise<void>;
  deleteProfile(id: string): Promise<boolean>;

  listTools(): Promise<StoredToolRecord[]>;
  getTool(id: string): Promise<StoredToolRecord | null>;
  getToolByName(name: string): Promise<StoredToolRecord | null>;
  upsertTool(record: StoredToolRecord): Promise<void>;
  deleteTool(id: string): Promise<boolean>;

  listToolsForProfile(profileId: string): Promise<StoredToolRecord[]>;
  assignToolToProfile(profileId: string, toolId: string): Promise<void>;
  unassignToolFromProfile(profileId: string, toolId: string): Promise<boolean>;

  listSessions(): Promise<StoredSessionRecord[]>;
  listSessionSummaries(
    profileId: string,
    channel: string,
  ): Promise<StoredSessionSummaryRecord[]>;
  getSession(id: string): Promise<StoredSessionRecord | null>;
  upsertSession(record: StoredSessionRecord): Promise<void>;
  deleteSession(id: string): Promise<boolean>;

  listMessagesForSession(sessionId: string): Promise<StoredSessionMessageRecord[]>;
  appendMessagesForSession(
    sessionId: string,
    messages: StoredSessionMessageRecord[],
  ): Promise<void>;
  replaceMessagesForSession(
    sessionId: string,
    messages: StoredSessionMessageRecord[],
  ): Promise<void>;
  deleteMessagesForSession(sessionId: string): Promise<void>;

  listTasks(): Promise<StoredTaskRecord[]>;
  getTask(id: string): Promise<StoredTaskRecord | null>;
  upsertTask(record: StoredTaskRecord): Promise<void>;
  deleteTask(id: string): Promise<boolean>;

  listTaskRuns(taskId: string, limit?: number): Promise<StoredTaskRunRecord[]>;
  getActiveTaskRun(taskId: string): Promise<StoredTaskRunRecord | null>;
  insertTaskRun(record: StoredTaskRunRecord): Promise<void>;
  updateTaskRun(record: StoredTaskRunRecord): Promise<void>;
}
