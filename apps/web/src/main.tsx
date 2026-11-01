import { Toaster } from "@nakama/ui/toaster";
import { TooltipProvider } from "@nakama/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ServiceWorkerUpdateProvider } from "@/components/ServiceWorkerUpdatePrompt";
import { ThemeProvider } from "@/context/theme-context";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <TooltipProvider>
          <ServiceWorkerUpdateProvider>
            <App />
          </ServiceWorkerUpdateProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
