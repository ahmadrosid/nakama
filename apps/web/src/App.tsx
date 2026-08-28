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
import { statusTabPath } from "@/lib/navigation";
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
const FilesPage = lazyPage(() => import("@/pages/FilesPage"), "FilesPage");
const HistoryPage = lazyPage(
  () => import("@/pages/HistoryPage"),
  "HistoryPage"
);
const IntegrationsPage = lazyPage(
  () => import("@/pages/IntegrationsPage"),
  "IntegrationsPage"
);
const LoginPage = lazyPage(() => import("@/pages/LoginPage"), "LoginPage");
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
                    element={<Navigate replace to={statusTabPath()} />}
                    path="/status"
                  />
                  <Route element={<ChatPage />} path="/chat" />
                  <Route
                    element={<ChatPage />}
                    path="/chat/:profileId/:sessionId"
                  />
                  <Route element={<HistoryPage />} path="/history" />
                  <Route element={<PlatformAdminGuard />}>
                    <Route element={<FilesPage />} path="/files" />
                  </Route>
                  <Route
                    element={<ToolPlaygroundPage />}
                    path="/system/playground/:toolId"
                  />
                  <Route element={<SystemPage />} path="/system" />
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
                    element={<Navigate replace to="/automations?tab=tasks" />}
                    path="/tasks"
                  />
                  <Route element={<IntegrationsPage />} path="/integrations" />
                  <Route element={<OrganizationPage />} path="/organization" />
                  <Route
                    element={<NotificationsPage />}
                    path="/notifications"
                  />
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
