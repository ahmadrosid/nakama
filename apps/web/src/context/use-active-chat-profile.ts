import { useContext } from "react";
import { ActiveChatProfileContext } from "@/context/active-chat-profile-context-shared";

export function useActiveChatProfile() {
  const context = useContext(ActiveChatProfileContext);
  if (!context) {
    throw new Error("useActiveChatProfile must be used within ActiveChatProfileProvider");
  }
  return context;
}
