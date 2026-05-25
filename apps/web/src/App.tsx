import { useState } from "react";
import { AppProvider } from "@/context/app-context";
import { Layout } from "@/components/Layout";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { ChatPage } from "@/pages/ChatPage";
import { HistoryPage } from "@/pages/HistoryPage";
import type { RequestedChatSession } from "@/lib/chat-history";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SoulPage } from "@/pages/SoulPage";
import { StatusPage } from "@/pages/StatusPage";
import { ToolsPage } from "@/pages/ToolsPage";
import type { PageId } from "@/lib/navigation";

export function App() {
  const [page, setPage] = useState<PageId>("chat");
  const [requestedChatSession, setRequestedChatSession] =
    useState<RequestedChatSession | null>(null);

  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        {page === "status" ? <StatusPage /> : null}
        {page === "chat" ? (
          <ChatPage
            requestedSession={requestedChatSession}
            onRequestedSessionHandled={() => setRequestedChatSession(null)}
            onNavigate={setPage}
          />
        ) : null}
        {page === "history" ? (
          <HistoryPage
            onNavigate={setPage}
            onOpenSession={setRequestedChatSession}
          />
        ) : null}
        {page === "profiles" ? <ProfilesPage /> : null}
        {page === "tools" ? <ToolsPage onNavigate={setPage} /> : null}
        {page === "soul" ? <SoulPage /> : null}
        {page === "automations" ? <AutomationsPage /> : null}
        {page === "settings" ? <SettingsPage onNavigate={setPage} /> : null}
      </Layout>
    </AppProvider>
  );
}
