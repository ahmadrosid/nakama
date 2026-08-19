import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { PlatformAdminGuard } from "@/components/PlatformAdminGuard";
import { SetupGuard } from "@/components/SetupGuard";
import { Spinner } from "@/components/ui/spinner";
import { AppProvider } from "@/context/app-context";
import { AuthProvider } from "@/context/auth-context";
import { AppQueryPrefetch } from "@/hooks/use-app-queries";
import { statusTabPath } from "@/lib/navigation";
import { onGlobalQueryError, queryClient } from "@/lib/query-client";

const AutomationsPage = lazy(() =>
  import("@/pages/AutomationsPage").then(({ AutomationsPage }) => ({
    default: AutomationsPage,
  }))
);
const ChatPage = lazy(() =>
  import("@/pages/ChatPage").then(({ ChatPage }) => ({ default: ChatPage }))
);
const FilesPage = lazy(() =>
  import("@/pages/FilesPage").then(({ FilesPage }) => ({ default: FilesPage }))
);
const HistoryPage = lazy(() =>
  import("@/pages/HistoryPage").then(({ HistoryPage }) => ({
    default: HistoryPage,
  }))
);
const IntegrationsPage = lazy(() =>
  import("@/pages/IntegrationsPage").then(({ IntegrationsPage }) => ({
    default: IntegrationsPage,
  }))
);
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then(({ LoginPage }) => ({ default: LoginPage }))
);
const NotificationsPage = lazy(() =>
  import("@/pages/NotificationsPage").then(({ NotificationsPage }) => ({
    default: NotificationsPage,
  }))
);
const ProfilesPage = lazy(() =>
  import("@/pages/ProfilesPage").then(({ ProfilesPage }) => ({
    default: ProfilesPage,
  }))
);
const PublicArtifactSharePage = lazy(() =>
  import("@/pages/PublicArtifactSharePage").then(
    ({ PublicArtifactSharePage }) => ({ default: PublicArtifactSharePage })
  )
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then(({ SettingsPage }) => ({
    default: SettingsPage,
  }))
);
const SetupWizardPage = lazy(() =>
  import("@/pages/SetupWizardPage").then(({ SetupWizardPage }) => ({
    default: SetupWizardPage,
  }))
);
const SkillDetailPage = lazy(() =>
  import("@/pages/SkillDetailPage").then(({ SkillDetailPage }) => ({
    default: SkillDetailPage,
  }))
);
const SystemPage = lazy(() =>
  import("@/pages/SystemPage").then(({ SystemPage }) => ({
    default: SystemPage,
  }))
);
const ToolPlaygroundPage = lazy(() =>
  import("@/pages/ToolPlaygroundPage").then(({ ToolPlaygroundPage }) => ({
    default: ToolPlaygroundPage,
  }))
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
          <Suspense
            fallback={
              <div className="flex h-svh items-center justify-center bg-background">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            }
          >
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
                    <Route element={<PlatformAdminGuard />}>
                      <Route element={<FilesPage />} path="/files" />
                    </Route>
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
                    <Route
                      element={<Navigate replace to="/automations?tab=tasks" />}
                      path="/tasks"
                    />
                    <Route
                      element={<IntegrationsPage />}
                      path="/integrations"
                    />
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
          </Suspense>
        </AppProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function App() {
  return <AppShell />;
}
