import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/**
 * A small static-analysis helper built on the TypeScript compiler API: which
 * modules are reachable from an entry file, which names each one imports, which
 * names a module exports, and which forbidden constructs (network, clock, random
 * numbers) its code uses. It reads files and never runs them.
 */

export type ImportRecord = Readonly<{
  file: string;
  specifier: string;
  /** Imported names; "default" for a default import and "*" for a namespace or `export *`. */
  names: readonly string[];
}>;

export type ModuleGraph = Readonly<{
  /** Absolute paths of the reachable files, entry first. */
  files: readonly string[];
  imports: readonly ImportRecord[];
  sources: ReadonlyMap<string, string>;
}>;

/** Absolute path of a file below the repository root. */
export function repoPath(...segments: string[]): string {
  return resolve(fileURLToPath(new URL("../../../", import.meta.url)), ...segments);
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** Every import, re-export and dynamic import of the module text. */
export function importsOf(file: string, text: string): ImportRecord[] {
  const records: ImportRecord[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      const clause = node.importClause;
      if (clause !== undefined) {
        if (clause.name !== undefined) {
          names.push("default");
        }
        const bindings = clause.namedBindings;
        if (bindings !== undefined) {
          if (ts.isNamespaceImport(bindings)) {
            names.push("*");
          } else {
            for (const element of bindings.elements) {
              names.push((element.propertyName ?? element.name).text);
            }
          }
        }
      }
      records.push({ file, specifier: node.moduleSpecifier.text, names });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const names =
        clause !== undefined && ts.isNamedExports(clause)
          ? clause.elements.map((element) => (element.propertyName ?? element.name).text)
          : ["*"];
      records.push({ file, specifier: node.moduleSpecifier.text, names });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      records.push({
        file,
        specifier: first !== undefined && ts.isStringLiteral(first) ? first.text : "<dynamic>",
        names: ["*"],
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return records;
}

function resolveRelative(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const candidate = resolve(dirname(fromFile), specifier.replace(/\.js$/u, ".ts"));
  return existsSync(candidate) ? candidate : undefined;
}

/** The entry file and every file reachable from it through relative imports. */
export function collectClosure(entry: string): ModuleGraph {
  const files: string[] = [];
  const imports: ImportRecord[] = [];
  const sources = new Map<string, string>();
  const queue = [entry];
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (file === undefined || files.includes(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    files.push(file);
    sources.set(file, text);
    for (const record of importsOf(file, text)) {
      imports.push(record);
      const next = resolveRelative(file, record.specifier);
      if (next !== undefined) {
        queue.push(next);
      }
    }
  }
  return { files, imports, sources };
}

/** Names that the module text exports itself (re-exports with `export *` are not followed). */
export function exportedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const statement of parse("module.ts", text).statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.add(declaration.name.text);
        }
      }
    } else if (
      exported &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

const FORBIDDEN_IDENTIFIERS: ReadonlySet<string> = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "sendBeacon",
  "randomUUID",
  "getRandomValues",
]);

const FORBIDDEN_MEMBERS: ReadonlySet<string> = new Set([
  "Date.now",
  "performance.now",
  "Math.random",
  "crypto.getRandomValues",
]);

/**
 * Uses of the network, the clock and random numbers in the module text. `Date.parse`
 * and `new Date(value)` with an argument are not a read of the current time and
 * are allowed; `Date.now()` and `new Date()` with no argument are not.
 */
export function findForbiddenUses(text: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      found.add(node.text);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const member = `${node.expression.text}.${node.name.text}`;
      if (FORBIDDEN_MEMBERS.has(member)) {
        found.add(member);
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      (node.arguments === undefined || node.arguments.length === 0)
    ) {
      found.add("new Date()");
    }
    ts.forEachChild(node, visit);
  };
  visit(parse("module.ts", text));
  return [...found].sort();
}

const NODE_GLOBALS: ReadonlySet<string> = new Set(["Buffer", "process", "require"]);

function isPropertyNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.name === node;
  }
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

/**
 * References to the Node.js globals `Buffer`, `process` and `require` in the module text.
 * A property that happens to have one of these names (`value.process`, `{ process: 1 }`)
 * is not a reference.
 */
export function findNodeGlobals(text: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && NODE_GLOBALS.has(node.text) && !isPropertyNameOnly(node)) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse("module.ts", text));
  return [...found].sort();
}
