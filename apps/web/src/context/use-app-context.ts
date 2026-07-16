import { useContext } from "react";
import { AppContext, type AppContextValue } from "@/context/app-context-shared";

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);

  if (!value) {
    throw new Error("useAppContext must be used within AppProvider");
  }

  return value;
}
