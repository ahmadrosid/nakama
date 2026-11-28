import type { StoredAuditEvent } from "@nakama/db";
import { INSTALLATION_AUDIT_ROUTES } from "./audit-routes-installation";
import { ORGS_AUDIT_ROUTES } from "./audit-routes-orgs";
import { RESOURCES_AUDIT_ROUTES } from "./audit-routes-resources";

export type AuditDescriptor = Pick<
  StoredAuditEvent,
  "action" | "resourceId" | "resourceType"
> & { orgId?: string | null };

/**
 * `[action, resourceType, resourceId?, orgId?]`. `:name` in a value is filled
 * from the route param of that name. A missing orgId falls back to the
 * caller's active org; `null` records an installation-wide event.
 */
export type AuditRule = readonly [
  action: string,
  resourceType: string,
  resourceId?: string | null,
  orgId?: string | null,
];

/**
 * Classifies a request by the route pattern Hono matched. Params are read
 * from the path itself, because a request rejected by org middleware never
 * reaches the handler that would populate `c.req.param()`.
 */
export function describeAuditEvent(
  method: string,
  routePattern: string,
  pathname: string
): AuditDescriptor | null {
  const rule = AUDIT_ROUTES.get(`${method} ${routePattern}`);

  if (!rule) {
    return null;
  }

  const [action, resourceType, resourceId, orgId] = rule;
  const params = routeParams(routePattern, pathname);

  const fill = (template: string): string =>
    template.replace(/:(\w+)/g, (_, name: string) => params[name] ?? "");

  const descriptor: AuditDescriptor = {
    action: fill(action),
    resourceId: resourceId ? fill(resourceId) || null : null,
    resourceType,
  };

  if (orgId !== undefined) {
    descriptor.orgId = orgId === null ? null : fill(orgId) || null;
  }

  return descriptor;
}

function routeParams(
  routePattern: string,
  pathname: string
): Record<string, string> {
  const segments = pathname.split("/");

  return Object.fromEntries(
    routePattern.split("/").flatMap((part, index) => {
      const name = part.match(/^:(\w+)/)?.[1];

      return name ? [[name, decodePathPart(segments[index] ?? "")]] : [];
    })
  );
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Security-event coverage checklist:
 * - authentication: setup, login success/failure, logout, password change and
 *   reset, MFA/passkey enrollment and removal, token rotation
 * - authorization: organization/member/invite lifecycle and role changes
 * - configuration: providers, skills, tools, automations, plugins, MCP
 *   servers, notification destinations, integrations, and installation
 *   settings
 * - sensitive resources: profile/org CRUD, export/import, session lifecycle,
 *   memory edits, artifact and shared-resource publication, tool runs
 *
 * Keyed by `METHOD route-pattern` exactly as the route is registered, so a
 * renamed route, or a new mutating route with no rule, fails the coverage test
 * instead of silently going unaudited.
 * Add a rule here whenever a new route joins one of those classes. Agent tool
 * calls inside a chat turn are recorded by the agent service (`tool.call`),
 * not by a route rule. Rows past the retention window are pruned
 * (`AUDIT_EVENT_RETENTION_DAYS`). Deliberately unaudited: chat message text
 * and LLM text/computer calls (hot path, like
 * tera-router's gateway), previews and connection tests (no state change),
 * push presence and user-context writes (client state), meet extension
 * control (ephemeral), automation drafts and read-state marks. Request bodies
 * are intentionally never recorded, so credentials cannot enter metadata.
 */
export const AUDIT_ROUTES = new Map<string, AuditRule>([
  ...INSTALLATION_AUDIT_ROUTES,
  ...ORGS_AUDIT_ROUTES,
  ...RESOURCES_AUDIT_ROUTES,
]);
