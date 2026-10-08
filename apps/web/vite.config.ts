import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  // svgr() lets `import Icon from "./icon.svg?react"` yield a React
  // component instead of a URL string - see
  // src/assets/icons/__tests__/example.test.tsx for a working example.
  plugins: [react(), tailwindcss(), tsconfigPaths(), svgr()],
  server: {
    watch: {
      usePolling: true,
    },
    host: true,
    strictPort: true,
    // Playwright (in the docker-compose-e2e.yml "playwright" container)
    // hits this server over the docker network as "http://web:5173", so
    // Vite's Host-header check needs to allow that hostname explicitly.
    allowedHosts: ["web"],
  },
});
