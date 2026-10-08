// Types for the design-system-kit's ESLint blocks (eslint.design-system.mjs, a
// kit file), so this app's TypeScript eslint.config.ts can import them.
import type { Linter } from "eslint";

declare const designSystem: Linter.Config[];
export default designSystem;
