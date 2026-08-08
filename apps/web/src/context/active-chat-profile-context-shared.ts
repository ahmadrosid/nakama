import { createContext } from "react";

export type ChatProfileSwitchHandler = (profileId: string) => void;

export interface ActiveChatProfileContextValue {
  profileId: string | null;
  registerChatProfileSwitchHandler: (
    handler: ChatProfileSwitchHandler | null
  ) => () => void;
  setProfileId: (profileId: string) => void;
  switchChatProfile: (profileId: string) => void;
}

export const ActiveChatProfileContext =
  createContext<ActiveChatProfileContextValue | null>(null);
