import type {
  AuthUserResponse,
  SetupAuthRequest,
  UpdateOrganizationRequest,
  UserOrgSummary,
} from "@nakama/core/contract";
import { createContext } from "react";

export interface AuthContextValue {
  activeOrg: UserOrgSummary | null;
  archiveOrg: (orgId: string) => Promise<void>;
  createOrg: (input: { name: string; slug: string }) => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  orgs: UserOrgSummary[];
  refreshSession: () => Promise<void>;
  setup: (request: SetupAuthRequest) => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  updateOrg: (orgId: string, input: UpdateOrganizationRequest) => Promise<void>;
  user: AuthUserResponse | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
