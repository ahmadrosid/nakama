import { createContext } from "react";

export type ChatProfileSwitchHandler = (profileId: string) => void;

export interface ActiveChatProfileContextValue {
  profileId: string | null;
  setProfileId: (profileId: string) => void;
  registerChatProfileSwitchHandler: (
    handler: ChatProfileSwitchHandler | null,
  ) => () => void;
  switchChatProfile: (profileId: string) => void;
}

export const ActiveChatProfileContext =
  createContext<ActiveChatProfileContextValue | null>(null);
