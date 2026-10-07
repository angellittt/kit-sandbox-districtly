import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/**
 * All HTTP calls in the web app go through the shared client in
 * `src/lib/axios`. It attaches the auth token and refreshes it when it
 * expires, so a raw `axios` import silently skips both.
 *
 * Type-only imports are fine: they are erased at build time.
 * The client itself (and its test) turn this rule off in apps/web/.oxlintrc.json.
 */
const isAxios = (source: string): boolean =>
  source === "axios" || source.startsWith("axios/");

/**
 * The module name of `import(...)` / `require(...)` when it is known at lint
 * time: a string literal, or a template literal with no `${}` parts.
 */
const staticSource = (node: ESTree.Node | undefined): unknown => {
  if (node?.type === "Literal") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
};

const isTypeOnlyImport = (node: ESTree.ImportDeclaration): boolean =>
  node.importKind === "type" ||
  (node.specifiers.length > 0 &&
    node.specifiers.every(
      (specifier) =>
        specifier.type === "ImportSpecifier" && specifier.importKind === "type",
    ));

const isTypeOnlyExport = (node: ESTree.ExportNamedDeclaration): boolean =>
  node.exportKind === "type" ||
  (node.specifiers.length > 0 &&
    node.specifiers.every((specifier) => specifier.exportKind === "type"));

export const noDirectAxios = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Use the shared API client from src/lib/axios instead of importing axios directly.",
    },
    messages: {
      noDirectAxios:
        'Don\'t import "axios" directly. Use the shared client from src/lib/axios, it adds the auth token and refreshes it.',
    },
    schema: [],
  },
  create: (context) => {
    const check = (node: ESTree.Node, source: unknown): void => {
      if (typeof source === "string" && isAxios(source)) {
        context.report({ node, messageId: "noDirectAxios" });
      }
    };

    return {
      ImportDeclaration: (node) => {
        if (!isTypeOnlyImport(node)) check(node, node.source.value);
      },
      ExportNamedDeclaration: (node) => {
        if (node.source && !isTypeOnlyExport(node)) {
          check(node, node.source.value);
        }
      },
      ExportAllDeclaration: (node) => {
        if (node.exportKind !== "type") check(node, node.source.value);
      },
      ImportExpression: (node) => {
        check(node, staticSource(node.source));
      },
      CallExpression: (node) => {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require"
        ) {
          check(node, staticSource(node.arguments[0]));
        }
      },
    };
  },
});
