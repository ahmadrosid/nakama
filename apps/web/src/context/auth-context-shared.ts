import { createContext } from "react";
import type { AuthUserResponse, SetupAuthRequest, UpdateOrganizationRequest, UserOrgSummary } from "@nakama/core/contract";

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
  updateOrg: (orgId: string, input: UpdateOrganizationRequest) => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
