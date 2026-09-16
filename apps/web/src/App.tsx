import { QueryClientProvider } from "@tanstack/react-query";
import { type ComponentType, lazy, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { PlatformAdminGuard } from "@/components/PlatformAdminGuard";
import { RouteBoundary } from "@/components/RouteBoundary";
import { SetupGuard } from "@/components/SetupGuard";
import { AppProvider } from "@/context/app-context";
import { AuthProvider } from "@/context/auth-context";
import { AppQueryPrefetch } from "@/hooks/use-app-queries";
import { PAGE_PATHS } from "@/lib/navigation";
import { onGlobalQueryError, queryClient } from "@/lib/query-client";

const lazyPage = <Name extends string>(
  load: () => Promise<Record<Name, ComponentType>>,
  name: Name
) => lazy(async () => ({ default: (await load())[name] }));

const AutomationsPage = lazyPage(
  () => import("@/pages/AutomationsPage"),
  "AutomationsPage"
);
const ChatPage = lazyPage(() => import("@/pages/ChatPage"), "ChatPage");
const CustomizePage = lazyPage(
  () => import("@/pages/CustomizePage"),
  "CustomizePage"
);
const SkillsPage = lazyPage(
  () => import("@/pages/CustomizePage"),
  "SkillsPage"
);
const FilesPage = lazyPage(() => import("@/pages/FilesPage"), "FilesPage");
const IntegrationsPage = lazyPage(
  () => import("@/pages/IntegrationsPage"),
  "IntegrationsPage"
);
const LoginPage = lazyPage(() => import("@/pages/LoginPage"), "LoginPage");
const PasswordResetPage = lazyPage(
  () => import("@/pages/PasswordResetPage"),
  "PasswordResetPage"
);
const AcceptInvitePage = lazyPage(
  () => import("@/pages/AcceptInvitePage"),
  "AcceptInvitePage"
);
const NotificationsPage = lazyPage(
  () => import("@/pages/NotificationsPage"),
  "NotificationsPage"
);
const OrganizationPage = lazyPage(
  () => import("@/pages/OrganizationPage"),
  "OrganizationPage"
);
const ProfilesPage = lazyPage(
  () => import("@/pages/ProfilesPage"),
  "ProfilesPage"
);
const PublicArtifactSharePage = lazyPage(
  () => import("@/pages/PublicArtifactSharePage"),
  "PublicArtifactSharePage"
);
const LlmProvidersPage = lazyPage(
  () => import("@/pages/SettingsPage"),
  "LlmProvidersPage"
);
const SettingsPage = lazyPage(
  () => import("@/pages/SettingsPage"),
  "SettingsPage"
);
const SetupWizardPage = lazyPage(
  () => import("@/pages/SetupWizardPage"),
  "SetupWizardPage"
);
const SkillDetailPage = lazyPage(
  () => import("@/pages/SkillDetailPage"),
  "SkillDetailPage"
);
const StatusPage = lazyPage(() => import("@/pages/StatusPage"), "StatusPage");
const LlmUsageTab = lazyPage(() => import("@/pages/StatusPage"), "LlmUsageTab");
const PluginPage = lazyPage(() => import("@/pages/PluginPage"), "PluginPage");
const PluginsPage = lazyPage(
  () => import("@/pages/PluginsPage"),
  "PluginsPage"
);
const ToolsPage = lazyPage(
  () => import("@/components/soul-tools/ToolsTab"),
  "ToolsTab"
);
const McpPage = lazyPage(
  () => import("@/components/soul-tools/McpTab"),
  "McpTab"
);
const SystemPage = lazyPage(() => import("@/pages/SystemPage"), "SystemPage");
const ToolPlaygroundPage = lazyPage(
  () => import("@/pages/ToolPlaygroundPage"),
  "ToolPlaygroundPage"
);
function QueryCacheListener() {
  useEffect(() => {
    const unsub = queryClient.getQueryCache().subscribe(onGlobalQueryError);
    return unsub;
  }, []);
  return null;
}

function AppShell() {
  return (
    <QueryClientProvider client={queryClient}>
      <QueryCacheListener />
      <AuthProvider>
        <AppQueryPrefetch />
        <AppProvider>
          <Routes>
            <Route
              element={
                <RouteBoundary fullScreen>
                  <AcceptInvitePage />
                </RouteBoundary>
              }
              path="/accept-invite"
            />
            <Route
              element={
                <RouteBoundary fullScreen>
                  <SetupWizardPage />
                </RouteBoundary>
              }
              path="/setup"
            />
            <Route
              element={
                <RouteBoundary fullScreen>
                  <LoginPage />
                </RouteBoundary>
              }
              path="/login"
            />
            <Route
              element={
                <RouteBoundary fullScreen>
                  <PasswordResetPage />
                </RouteBoundary>
              }
              path="/reset-password"
            />
            <Route
              element={
                <RouteBoundary fullScreen>
                  <PublicArtifactSharePage />
                </RouteBoundary>
              }
              path="/s/:token"
            />
            <Route element={<AuthGuard />}>
              <Route element={<SetupGuard />}>
                <Route element={<Layout />}>
                  <Route element={<Navigate replace to="/chat" />} index />
                  <Route
                    element={<Navigate replace to={PAGE_PATHS.workers} />}
                    path="/status"
                  />
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route element={<StatusPage />} path="/workers" />
                  </Route>
                  <Route element={<ChatPage />} path="/chat" />
                  <Route
                    element={<ChatPage />}
                    path="/chat/:profileId/:sessionId"
                  />
                  <Route element={<CustomizePage />} path="/customize" />
                  <Route element={<PlatformAdminGuard />}>
                    <Route element={<SkillsPage />} path={PAGE_PATHS.skills} />
                  </Route>
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route element={<LlmUsageTab />} path={PAGE_PATHS.usage} />
                  </Route>
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route element={<FilesPage />} path="/files" />
                  </Route>
                  <Route
                    element={<ToolPlaygroundPage />}
                    path="/system/playground/:toolId"
                  />
                  <Route element={<SystemPage />} path="/system" />
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route element={<ToolsPage />} path={PAGE_PATHS.tools} />
                  </Route>
                  <Route element={<PlatformAdminGuard />}>
                    <Route element={<McpPage />} path={PAGE_PATHS.mcp} />
                  </Route>
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route
                      element={<PluginsPage />}
                      path="/customize/plugins/:pluginId"
                    />
                  </Route>
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route
                      element={<PluginsPage />}
                      path="/customize/plugins"
                    />
                    <Route
                      element={<PluginsPage />}
                      path="/system/plugins/:pluginId"
                    />
                  </Route>
                  <Route element={<PluginPage />} path="/plugins/:pluginId" />
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route element={<ProfilesPage />} path="/profiles" />
                  </Route>
                  <Route element={<PlatformAdminGuard />}>
                    <Route
                      element={<SkillDetailPage />}
                      path="/profiles/skills/:skillId"
                    />
                  </Route>
                  <Route element={<AutomationsPage />} path="/automations" />
                  <Route
                    element={<Navigate replace to="/automations" />}
                    path="/tasks"
                  />
                  <Route element={<IntegrationsPage />} path="/integrations" />
                  <Route element={<PlatformAdminGuard allowOrgAdmin />}>
                    <Route
                      element={<OrganizationPage />}
                      path="/organization"
                    />
                  </Route>
                  <Route
                    element={<NotificationsPage />}
                    path="/notifications"
                  />
                  <Route element={<PlatformAdminGuard />}>
                    <Route
                      element={<LlmProvidersPage />}
                      path="/customize/providers"
                    />
                  </Route>
                  <Route element={<SettingsPage />} path="/settings" />
                  <Route element={<Navigate replace to="/chat" />} path="*" />
                </Route>
              </Route>
            </Route>
          </Routes>
        </AppProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function App() {
  return <AppShell />;
}
