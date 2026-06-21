import type { AgentService } from "../services/agent-service";
import type { AutomationService } from "../services/automation-service";
import type { McpService } from "../services/mcp-service";
import type { TaskService } from "../services/task-service";
import { SystemStatusService } from "../services/system-status-service";
import type { WorkerManagerService } from "../services/worker-manager-service";
import type { AuthService } from "../services/auth-service";
import type { OrgService } from "../services/org-service";
import type { DatabaseAdapter } from "@tinyclaw/db";

export interface ServerOptions {
  agent: AgentService;
  automationService: AutomationService;
  taskService: TaskService;
  systemStatus: SystemStatusService;
  workerManager: WorkerManagerService;
  mcpService: McpService;
  authService?: AuthService | null;
  orgService?: OrgService | null;
  databaseAdapter?: DatabaseAdapter | null;
  webDistDir?: string | null;
}
