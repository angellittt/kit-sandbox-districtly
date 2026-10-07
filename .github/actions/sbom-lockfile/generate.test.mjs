// Run with: node --test ".github/actions/**/*.test.mjs"
// Exercises generate.sh with a stub in place of cdxgen, so it runs offline.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "generate.sh");

// A two-package workspace: root (dev dep only) and apps/web (react prod,
// vitest dev).
const cdxgenOutput = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  metadata: {
    component: {
      name: "repo",
      "bom-ref": "pkg:npm/repo",
      components: [
        {
          name: "web",
          "bom-ref": "pkg:npm/web@1.0.0",
          properties: [{ name: "internal:virtual_path", value: "apps/web" }],
        },
      ],
    },
  },
  components: [
    { name: "react", "bom-ref": "pkg:npm/react@1.0.0", scope: "optional" },
    { name: "vitest", "bom-ref": "pkg:npm/vitest@1.0.0", scope: "optional" },
  ],
  dependencies: [
    { ref: "pkg:npm/repo", dependsOn: ["pkg:npm/web@1.0.0"] },
    {
      ref: "pkg:npm/web@1.0.0",
      dependsOn: ["pkg:npm/react@1.0.0", "pkg:npm/vitest@1.0.0"],
    },
  ],
};

const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sbom-lockfile-"));
  const project = path.join(dir, "project");
  mkdirSync(path.join(project, "apps/web"), { recursive: true });
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "repo", devDependencies: { prettier: "1" } }),
  );
  writeFileSync(
    path.join(project, "apps/web/package.json"),
    JSON.stringify({
      name: "web",
      dependencies: { react: "1" },
      devDependencies: { vitest: "1" },
    }),
  );
  const fixture = path.join(dir, "fixture.json");
  writeFileSync(fixture, JSON.stringify(cdxgenOutput));
  // Stub cdxgen: records its args, writes the fixture to the -o path.
  const stub = path.join(dir, "cdxgen");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
echo "$@" > "${dir}/args"
echo "\${FETCH_LICENSE:-}" > "${dir}/fetch-license"
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then cp "${fixture}" "$2"; fi
  shift
done
`,
  );
  chmodSync(stub, 0o755);
  return { dir, project, stub };
};

const run = (args, { stub }) => {
  const env = { ...process.env, CDXGEN: stub };
  delete env.FETCH_LICENSE;
  return spawnSync("bash", [script, ...args], { encoding: "utf8", env });
};

test("full mode keeps every component and asks cdxgen for CycloneDX 1.6", () => {
  const ctx = setup();
  const out = path.join(ctx.dir, "out");
  const r = run(
    [
      "--mode",
      "full",
      "--name",
      "source",
      "--path",
      ctx.project,
      "--output-dir",
      out,
    ],
    ctx,
  );
  assert.equal(r.status, 0, r.stderr);
  const bom = JSON.parse(
    readFileSync(path.join(out, "source.cdx.json"), "utf8"),
  );
  assert.equal(bom.components.length, 2);
  const args = readFileSync(path.join(ctx.dir, "args"), "utf8");
  assert.match(args, /--spec-version 1\.6/);
  assert.match(args, /--no-install-deps/);
});

test("prod mode keeps only the workspace's production dependencies", () => {
  const ctx = setup();
  const out = path.join(ctx.dir, "out");
  const r = run(
    [
      "--mode",
      "prod",
      "--name",
      "web",
      "--path",
      ctx.project,
      "--workspace",
      "apps/web",
      "--output-dir",
      out,
    ],
    ctx,
  );
  assert.equal(r.status, 0, r.stderr);
  const bom = JSON.parse(readFileSync(path.join(out, "web.cdx.json"), "utf8"));
  assert.deepEqual(
    bom.components.map((c) => c.name),
    ["react"],
  );
  assert.equal(bom.metadata.component.name, "web");
});

test("prints the SBOM path so callers can pick it up", () => {
  const ctx = setup();
  const out = path.join(ctx.dir, "out");
  const r = run(
    [
      "--mode",
      "full",
      "--name",
      "source",
      "--path",
      ctx.project,
      "--output-dir",
      out,
    ],
    ctx,
  );
  assert.equal(
    r.stdout.trim().split("\n").at(-1),
    path.join(out, "source.cdx.json"),
  );
});

test("rejects an unknown mode", () => {
  const ctx = setup();
  const r = run(["--mode", "dev", "--name", "x", "--path", ctx.project], ctx);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--mode must be prod or full/);
});

test("requires a name", () => {
  const ctx = setup();
  const r = run(["--mode", "full", "--path", ctx.project], ctx);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--name is required/);
});

test("--fetch-licenses asks cdxgen to look up licenses on the registry", () => {
  const ctx = setup();
  const base = ["--mode", "full", "--name", "x", "--path", ctx.project];
  const out = ["--output-dir", path.join(ctx.dir, "out")];
  const fetched = () =>
    readFileSync(path.join(ctx.dir, "fetch-license"), "utf8").trim();

  assert.equal(run([...base, ...out], ctx).status, 0);
  assert.equal(fetched(), "");

  const r = run([...base, "--fetch-licenses", ...out], ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fetched(), "true");
});
