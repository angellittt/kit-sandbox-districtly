// design-system-kit 0.4.1 · profile shadcn · wiring (Vite): ESLint blocks
//
// Setup spreads these into the app's existing flat config, after the repo's
// own entries (`...designSystem`), and never edits the repo's rules. If the
// app has no flat config, Setup writes one that is just
// `export default [...designSystem]`.
//
// Accessibility: if the repo already runs jsx-a11y rules (oxlint's jsx-a11y
// plugin, or eslint-plugin-jsx-a11y), nothing more is needed; otherwise
// Setup also adds the jsx-a11y block from ../next/eslint.config.mjs and the
// eslint-plugin-jsx-a11y dev dependency.
const designSystem = [
  {
    // Vendored components carry disable comments for other configs' rules
    // (react-hooks/exhaustive-deps); a repo that doesn't enable them would
    // report the comments as unused.
    files: ["src/components/ui/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  // Kit scripts are linted in the kit, not per client.
  { ignores: ["scripts/**"] },
];

export default designSystem;
