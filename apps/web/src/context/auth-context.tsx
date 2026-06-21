import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import type { SetupAuthRequest } from "@tinyclaw/core/contract";

interface AuthContextValue {
  user: { email: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setup: (request: SetupAuthRequest) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function refreshAuthenticatedQueries(): void {
  void queryClient.invalidateQueries();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    client
      .getMe()
      .then((me) => {
        setUser(me);
        refreshAuthenticatedQueries();
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const setup = useCallback(async (request: SetupAuthRequest) => {
    const me = await client.setupUser(request);
    setUser(me);
    refreshAuthenticatedQueries();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await client.login(email, password);
    setUser(me);
    refreshAuthenticatedQueries();
  }, []);

  const logout = useCallback(async () => {
    await client.logout();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    setup,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
