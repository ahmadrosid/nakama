export type PageId = "chat" | "history" | "profiles" | "tools" | "soul" | "automations";

export interface NavItem {
  id: PageId;
  label: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "chat",
    label: "Chat",
    description: "Talk to the agent with streaming replies",
  },
  {
    id: "history",
    label: "History",
    description: "Browse and reopen saved chat sessions",
  },
  {
    id: "profiles",
    label: "Profiles",
    description: "Manage bot configs and tool allowlists",
  },
  {
    id: "tools",
    label: "Tools",
    description: "Browse tools created by the agent",
  },
  {
    id: "soul",
    label: "Soul",
    description: "Identity stack files and templates",
  },
  {
    id: "automations",
    label: "Automations",
    description: "Draft workflows from natural language",
  },
];
