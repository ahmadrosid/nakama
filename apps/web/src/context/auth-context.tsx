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

interface AuthContextValue {
  user: { email: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AUTH_STORAGE_KEY = "tinyclaw_auth_token";

const AuthContext = createContext<AuthContextValue | null>(null);

function refreshAuthenticatedQueries(): void {
  void queryClient.invalidateQueries();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_STORAGE_KEY);
    if (token) {
      client.setAuthToken(token);
      client
        .getMe()
        .then((me) => {
          setUser(me);
          refreshAuthenticatedQueries();
        })
        .catch(() => {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          client.setAuthToken(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const setup = useCallback(async (email: string, password: string) => {
    const response = await client.setupUser(email, password);
    localStorage.setItem(AUTH_STORAGE_KEY, response.token);
    client.setAuthToken(response.token);
    const me = await client.getMe();
    setUser(me);
    refreshAuthenticatedQueries();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await client.login(email, password);
    localStorage.setItem(AUTH_STORAGE_KEY, response.token);
    client.setAuthToken(response.token);
    const me = await client.getMe();
    setUser(me);
    refreshAuthenticatedQueries();
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    client.setAuthToken(null);
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
