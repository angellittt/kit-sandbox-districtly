import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/config/global.css";
// Registers the global Zod error map - must run before any schema is used.
import "@/lib/zod-error-map";
import { ThemeProvider } from "@/components/theme-provider";
import App from "./App.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}
createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
