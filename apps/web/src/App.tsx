import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { PlatformAdminGuard } from "@/components/PlatformAdminGuard";
import { SetupGuard } from "@/components/SetupGuard";
import { AppProvider } from "@/context/app-context";
import { AuthProvider } from "@/context/auth-context";
import { AppQueryPrefetch } from "@/hooks/use-app-queries";
import { statusTabPath } from "@/lib/navigation";
import { onGlobalQueryError, queryClient } from "@/lib/query-client";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { ChatPage } from "@/pages/ChatPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { PublicArtifactSharePage } from "@/pages/PublicArtifactSharePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SetupWizardPage } from "@/pages/SetupWizardPage";
import { SkillDetailPage } from "@/pages/SkillDetailPage";
import { SystemPage } from "@/pages/SystemPage";
import { TasksPage } from "@/pages/TasksPage";
import { ToolPlaygroundPage } from "@/pages/ToolPlaygroundPage";

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
            <Route element={<SetupWizardPage />} path="/setup" />
            <Route element={<LoginPage />} path="/login" />
            <Route element={<PublicArtifactSharePage />} path="/s/:token" />
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
                  <Route
                    element={<ToolPlaygroundPage />}
                    path="/system/playground/:toolId"
                  />
                  <Route element={<SystemPage />} path="/system" />
                  <Route element={<PlatformAdminGuard />}>
                    <Route element={<ProfilesPage />} path="/profiles" />
                    <Route
                      element={<SkillDetailPage />}
                      path="/profiles/skills/:skillId"
                    />
                  </Route>
                  <Route element={<AutomationsPage />} path="/automations" />
                  <Route element={<TasksPage />} path="/tasks" />
                  <Route element={<IntegrationsPage />} path="/integrations" />
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
