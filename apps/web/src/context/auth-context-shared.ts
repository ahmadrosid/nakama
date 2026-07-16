import { createContext } from "react";
import type { AuthUserResponse, SetupAuthRequest, UserOrgSummary } from "@nakama/core/contract";

export interface AuthContextValue {
  user: AuthUserResponse | null;
  orgs: UserOrgSummary[];
  activeOrg: UserOrgSummary | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setup: (request: SetupAuthRequest) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  createOrg: (input: { name: string; slug: string }) => Promise<void>;
  updateOrg: (orgId: string, input: { name: string }) => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
