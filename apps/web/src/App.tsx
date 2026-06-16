import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "@/context/app-context";
import { AuthProvider } from "@/context/auth-context";
import { AppQueryPrefetch } from "@/hooks/use-app-queries";
import { queryClient, onGlobalQueryError } from "@/lib/query-client";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";
import { SetupGuard } from "@/components/SetupGuard";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { ChatPage } from "@/pages/ChatPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { LoginPage } from "@/pages/LoginPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SetupWizardPage } from "@/pages/SetupWizardPage";
import { SoulPage } from "@/pages/SoulPage";
import { StatusPage } from "@/pages/StatusPage";
import { TasksPage } from "@/pages/TasksPage";

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
            <Route path="/setup" element={<SetupWizardPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AuthGuard />}>
              <Route element={<SetupGuard />}>
                <Route element={<Layout />}>
                  <Route index element={<Navigate to="/chat" replace />} />
                  <Route path="/status" element={<StatusPage />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/chat/:profileId/:sessionId" element={<ChatPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/profiles" element={<ProfilesPage />} />
                  <Route path="/system" element={<SoulPage />} />
                  <Route path="/automations" element={<AutomationsPage />} />
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/chat" replace />} />
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
