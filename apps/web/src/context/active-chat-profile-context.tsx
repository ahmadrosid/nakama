import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActiveChatProfileContext,
  type ActiveChatProfileContextValue,
  type ChatProfileSwitchHandler,
} from "@/context/active-chat-profile-context-shared";
import {
  readStoredActiveChatProfileId,
  writeStoredActiveChatProfileId,
} from "@/lib/chat-history";

export function ActiveChatProfileProvider({ children }: { children: ReactNode }) {
  const [profileId, setProfileIdState] = useState<string | null>(() =>
    readStoredActiveChatProfileId(),
  );
  const switchHandlerRef = useRef<ChatProfileSwitchHandler | null>(null);

  const setProfileId = useCallback((nextProfileId: string) => {
    setProfileIdState(nextProfileId);
    writeStoredActiveChatProfileId(nextProfileId);
  }, []);

  const registerChatProfileSwitchHandler = useCallback(
    (handler: ChatProfileSwitchHandler | null) => {
      switchHandlerRef.current = handler;
      return () => {
        if (switchHandlerRef.current === handler) {
          switchHandlerRef.current = null;
        }
      };
    },
    [],
  );

  const switchChatProfile = useCallback(
    (nextProfileId: string) => {
      setProfileId(nextProfileId);
      switchHandlerRef.current?.(nextProfileId);
    },
    [setProfileId],
  );

  const value = useMemo<ActiveChatProfileContextValue>(
    () => ({
      profileId,
      setProfileId,
      registerChatProfileSwitchHandler,
      switchChatProfile,
    }),
    [profileId, setProfileId, registerChatProfileSwitchHandler, switchChatProfile],
  );

  return (
    <ActiveChatProfileContext.Provider value={value}>
      {children}
    </ActiveChatProfileContext.Provider>
  );
}
