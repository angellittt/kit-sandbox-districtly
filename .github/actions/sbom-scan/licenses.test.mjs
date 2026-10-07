// Run with: node --test ".github/actions/**/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  flaggedComponents,
  licenseSummary,
  unlicensedComponents,
} from "./licenses.mjs";

const byId = (id) => ({ license: { id } });
const byName = (name) => ({ license: { name } });
const expr = (expression) => ({ expression });

const component = (name, licenses, group = "") => ({
  group,
  name,
  version: "1.0.0",
  licenses,
});

const bom = {
  components: [
    component("mit-lib", [byId("MIT")]),
    component("gpl-lib", [byId("GPL-3.0-only")]),
    component("agpl-lib", [byId("AGPL-3.0-or-later")]),
    component("lgpl-lib", [byId("LGPL-2.1-only")]),
    component("sspl-lib", [byName("SSPL-1.0")]),
    component("named-gpl", [byName("GNU General Public License v2")]),
    component("dual", [expr("MIT OR GPL-2.0-only")]),
    component("scoped", [byId("GPL-2.0-only")], "@acme"),
    component("no-license", undefined),
    component("apache", [byId("Apache-2.0")]),
    component("busl-lib", [byId("BUSL-1.1")]),
    component("named-busl", [byName("Business Source License 1.1")]),
    component("boost", [byId("BSL-1.0")]),
  ],
};

test("finds GPL, AGPL, LGPL, SSPL and BUSL by id, name and expression", () => {
  assert.deepEqual(
    flaggedComponents(bom).map((c) => c.name),
    [
      "@acme/scoped",
      "agpl-lib",
      "busl-lib",
      "dual",
      "gpl-lib",
      "lgpl-lib",
      "named-busl",
      "named-gpl",
      "sspl-lib",
    ],
  );
});

test("the Boost license (BSL-1.0) isn't flagged", () => {
  assert.ok(!flaggedComponents(bom).some((c) => c.name === "boost"));
});

test("packages with no license data are listed by name", () => {
  assert.deepEqual(unlicensedComponents(bom), [
    { name: "no-license", version: "1.0.0" },
  ]);
});

test("keeps the full license text so dual licenses are visible", () => {
  const dual = flaggedComponents(bom).find((c) => c.name === "dual");
  assert.equal(dual.license, "MIT OR GPL-2.0-only");
});

test("nested components are checked too", () => {
  const nested = {
    components: [
      component("parent", [byId("MIT")]),
      { ...component("child", [byId("GPL-3.0-only")]), components: [] },
    ],
  };
  nested.components[0].components = [component("inner", [byId("AGPL-3.0")])];
  assert.deepEqual(
    flaggedComponents(nested).map((c) => c.name),
    ["child", "inner"],
  );
});

test("the same package listed twice shows once", () => {
  const twice = {
    components: [
      component("gpl-lib", [byId("GPL-3.0-only")]),
      component("gpl-lib", [byId("GPL-3.0-only")]),
    ],
  };
  assert.equal(flaggedComponents(twice).length, 1);
});

test("summary is a warning table and lists unknown licenses", () => {
  const md = licenseSummary(bom, { name: "source" });
  assert.match(md, /### Flagged licenses: source/);
  assert.match(md, /9 packages/);
  assert.match(md, /Warning only/);
  assert.match(md, /\| gpl-lib \| 1\.0\.0 \| GPL-3\.0-only \|/);
  assert.match(md, /1 package has no license data/);
  assert.match(md, /\| no-license \| 1\.0\.0 \|/);
});

test("summary for a clean SBOM", () => {
  const md = licenseSummary(
    { components: [component("mit-lib", [byId("MIT")])] },
    { name: "web" },
  );
  assert.match(md, /No flagged licenses found/);
});
