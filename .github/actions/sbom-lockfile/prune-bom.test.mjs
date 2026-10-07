// Run with: node --test ".github/actions/**/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { pruneToProd } from "./prune-bom.mjs";

const lib = (name, group = "") => {
  const full = group ? `${group}/${name}` : name;
  return {
    group,
    name,
    version: "1.0.0",
    purl: `pkg:npm/${full}@1.0.0`,
    "bom-ref": `pkg:npm/${full}@1.0.0`,
    type: "library",
    scope: "optional",
  };
};

const workspace = (name, dir) => ({
  group: "",
  name,
  version: "1.0.0",
  "bom-ref": `pkg:npm/${name}@1.0.0`,
  type: "application",
  properties: [
    { name: "internal:is_workspace", value: "true" },
    { name: "SrcFile", value: `${dir}/package.json` },
    { name: "internal:virtual_path", value: dir },
  ],
});

const ref = (name) => `pkg:npm/${name}@1.0.0`;

// Monorepo: web depends on react (prod), vitest (dev) and @repo/ui (prod,
// workspace). @repo/ui depends on clsx (prod) and storybook (dev). react and
// vitest both pull in a shared "tslib".
const fixture = () => ({
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  metadata: {
    component: {
      name: "monorepo",
      "bom-ref": "pkg:npm/monorepo",
      type: "application",
      components: [
        workspace("web", "apps/web"),
        workspace("ui", "packages/ui"),
      ],
    },
  },
  components: [
    lib("react"),
    lib("scheduler"),
    lib("tslib"),
    lib("vitest"),
    lib("vite"),
    lib("clsx"),
    lib("storybook"),
    lib("prettier"),
  ],
  dependencies: [
    {
      ref: "pkg:npm/monorepo",
      dependsOn: [ref("web"), ref("ui"), ref("prettier")],
    },
    { ref: ref("web"), dependsOn: [ref("react"), ref("vitest"), ref("ui")] },
    { ref: ref("ui"), dependsOn: [ref("clsx"), ref("storybook")] },
    { ref: ref("react"), dependsOn: [ref("scheduler"), ref("tslib")] },
    { ref: ref("vitest"), dependsOn: [ref("vite"), ref("tslib")] },
    { ref: ref("scheduler"), dependsOn: [] },
    { ref: ref("tslib"), dependsOn: [] },
    { ref: ref("vite"), dependsOn: [] },
    { ref: ref("clsx"), dependsOn: [] },
    { ref: ref("storybook"), dependsOn: [] },
    { ref: ref("prettier"), dependsOn: [] },
  ],
});

const packageJsons = {
  ".": { name: "monorepo", devDependencies: { prettier: "1" } },
  "apps/web": {
    name: "web",
    dependencies: { react: "1", ui: "workspace:*" },
    devDependencies: { vitest: "1" },
  },
  "packages/ui": {
    name: "ui",
    dependencies: { clsx: "1" },
    devDependencies: { storybook: "1" },
  },
};
const readPackageJson = (dir) => packageJsons[dir];

const names = (bom) => bom.components.map((c) => c.name).sort();

test("keeps prod deps and their transitive deps, drops dev deps", () => {
  const out = pruneToProd(fixture(), {
    workspace: "apps/web",
    readPackageJson,
  });
  assert.deepEqual(names(out), ["clsx", "react", "scheduler", "tslib", "ui"]);
});

test("follows only the prod deps of a workspace package reached as a dependency", () => {
  const out = pruneToProd(fixture(), {
    workspace: "apps/web",
    readPackageJson,
  });
  assert.ok(!names(out).includes("storybook"));
  assert.ok(names(out).includes("clsx"));
});

test("makes the target workspace the SBOM's root component", () => {
  const out = pruneToProd(fixture(), {
    workspace: "apps/web",
    readPackageJson,
  });
  assert.equal(out.metadata.component.name, "web");
  assert.equal(out.metadata.component.components, undefined);
});

test("marks every kept component as required", () => {
  const out = pruneToProd(fixture(), {
    workspace: "apps/web",
    readPackageJson,
  });
  assert.ok(out.components.every((c) => c.scope === "required"));
});

test("keeps only dependency edges between kept components", () => {
  const out = pruneToProd(fixture(), {
    workspace: "apps/web",
    readPackageJson,
  });
  const web = out.dependencies.find((d) => d.ref === ref("web"));
  assert.deepEqual(web.dependsOn.sort(), [ref("react"), ref("ui")]);
  assert.ok(!out.dependencies.some((d) => d.ref === ref("vitest")));
  assert.ok(!out.dependencies.some((d) => d.ref === "pkg:npm/monorepo"));
});

test("uses the root project when no workspace is given", () => {
  const bom = fixture();
  bom.dependencies[0].dependsOn.push(ref("tslib"));
  const out = pruneToProd(bom, {
    readPackageJson: () => ({ name: "monorepo", dependencies: { tslib: "1" } }),
  });
  assert.equal(out.metadata.component.name, "monorepo");
  assert.deepEqual(names(out), ["tslib"]);
});

test("fails clearly when the workspace isn't in the SBOM", () => {
  assert.throws(
    () => pruneToProd(fixture(), { workspace: "apps/nope", readPackageJson }),
    /apps\/nope.*not found/,
  );
});

test("does not mutate the input SBOM", () => {
  const bom = fixture();
  const before = JSON.stringify(bom);
  pruneToProd(bom, { workspace: "apps/web", readPackageJson });
  assert.equal(JSON.stringify(bom), before);
});
