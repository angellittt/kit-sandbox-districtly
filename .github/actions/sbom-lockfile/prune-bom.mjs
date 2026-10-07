#!/usr/bin/env node
// Prunes a cdxgen lockfile SBOM down to one project's production dependencies.
//
// Why not cdxgen's --required-only: for pnpm lockfiles it marks every
// transitive dependency as "optional", so --required-only keeps only direct
// dependencies (express without body-parser, etc). Instead this walks
// cdxgen's dependency graph from the project's `dependencies` (and
// `optionalDependencies`) in package.json, which gives the same set of
// packages as `pnpm deploy --prod`.
//
// Usage: prune-bom.mjs <in.cdx.json> <out.cdx.json> <project-dir> [workspace]
//   project-dir: the folder cdxgen scanned (holds the lockfile)
//   workspace:   workspace folder relative to project-dir, e.g. apps/web.
//                Omit for a single-package repo.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prop = (component, name) =>
  component.properties?.find((p) => p.name === name)?.value;

const fullName = (component) =>
  component.group ? `${component.group}/${component.name}` : component.name;

// Workspace components carry their own nested `components` list; drop it so
// kept entries are flat.
const withoutNested = (component) => {
  const copy = { ...component };
  delete copy.components;
  return copy;
};

const prodDepNames = (pkg) =>
  new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.optionalDependencies ?? {}),
  ]);

/**
 * @param {object} bom CycloneDX SBOM produced by cdxgen for a lockfile
 * @param {{ workspace?: string, readPackageJson: (dir: string) => object }} options
 *   readPackageJson gets a dir relative to the scanned project ("." for the root)
 * @returns {object} a new SBOM holding only the production dependency tree
 */
export const pruneToProd = (bom, { workspace, readPackageJson }) => {
  const root = bom.metadata.component;
  const workspaces = root.components ?? [];
  const workspaceDir = (c) =>
    prop(c, "internal:virtual_path") ?? path.dirname(prop(c, "SrcFile") ?? "");

  let target = root;
  if (workspace && path.normalize(workspace) !== ".") {
    const wanted = path.normalize(workspace);
    target = workspaces.find((c) => path.normalize(workspaceDir(c)) === wanted);
    if (!target) {
      throw new Error(
        `Workspace "${workspace}" not found in the SBOM. Found: ${
          workspaces.map(workspaceDir).join(", ") || "none"
        }`,
      );
    }
  }

  const byRef = new Map();
  for (const c of [root, ...workspaces, ...(bom.components ?? [])]) {
    byRef.set(c["bom-ref"], c);
  }
  const edges = new Map(
    (bom.dependencies ?? []).map((d) => [d.ref, d.dependsOn ?? []]),
  );
  const dirOf = (c) => (c === root ? "." : workspaceDir(c));
  const isProject = (c) => c === root || workspaces.includes(c);

  // Project nodes (root or workspaces) list their dev deps as edges too, so
  // for those only follow edges named in package.json's prod dependencies.
  const next = (refId) => {
    const component = byRef.get(refId);
    const out = edges.get(refId) ?? [];
    if (!component || !isProject(component)) return out;
    const allowed = prodDepNames(readPackageJson(dirOf(component)));
    return out.filter((r) => {
      const dep = byRef.get(r);
      return dep && allowed.has(fullName(dep));
    });
  };

  const targetRef = target["bom-ref"];
  const kept = new Set([targetRef]);
  const queue = [targetRef];
  while (queue.length) {
    for (const r of next(queue.pop())) {
      if (!kept.has(r)) {
        kept.add(r);
        queue.push(r);
      }
    }
  }

  const keptComponents = [...kept]
    .filter((r) => r !== targetRef)
    .map((r) => byRef.get(r))
    .filter(Boolean)
    .map((c) => ({ ...withoutNested(c), scope: "required" }));

  return {
    ...bom,
    metadata: { ...bom.metadata, component: withoutNested(target) },
    components: keptComponents,
    dependencies: [...kept].map((r) => ({
      ref: r,
      dependsOn: next(r).filter((d) => kept.has(d)),
    })),
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, output, projectDir, workspace] = process.argv.slice(2);
  if (!input || !output || !projectDir) {
    console.error(
      "Usage: prune-bom.mjs <in.cdx.json> <out.cdx.json> <project-dir> [workspace]",
    );
    process.exit(2);
  }
  const bom = JSON.parse(readFileSync(input, "utf8"));
  const pruned = pruneToProd(bom, {
    workspace,
    readPackageJson: (dir) =>
      JSON.parse(
        readFileSync(path.join(projectDir, dir, "package.json"), "utf8"),
      ),
  });
  writeFileSync(output, `${JSON.stringify(pruned, null, 2)}\n`);
  console.log(
    `Kept ${pruned.components.length} of ${bom.components?.length ?? 0} components (production dependencies of ${pruned.metadata.component.name}).`,
  );
}
