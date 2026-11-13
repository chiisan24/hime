import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";

import { inspectPreviewBuild } from "./preview-preflight.mjs";

export const WEB_MODULE_MANIFEST_FILENAME = "web-module-manifest.json";

const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_KEYS = Object.freeze(["modules", "packages", "schemaVersion"]);
const MANIFEST_MODULE_KEYS = Object.freeze([
  "importedPaths",
  "path",
  "renderedExports",
  "sha256",
]);

const ANALYZABLE_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;
const ROUTE_ENTRY_PATTERN = /^src\/app\/[^/]+\/routes\.tsx$/u;
const ANALYST_MODULE_PREFIX = "src/app/analyst/";
const BUILD_CONFIG_MODULE_PREFIX = "src/config/";
const ANALYST_PAGES_MODULE = "src/app/analyst/pages.tsx";
const ANALYST_ROUTES_MODULE = "src/app/analyst/routes.tsx";
const ANALYST_NAVIGATION_MODULE = "src/app/analyst/navigationItems.ts";
const PUBLIC_PAGES_MODULE = "src/app/public/pages.tsx";
const SHARED_SHELL_MODULE = "src/shared/ui/AppShell.tsx";
const REQUIRED_APP_MODULES = Object.freeze(["src/main.tsx", "src/App.tsx"]);

const RETIRED_PUBLIC_SOURCES_PATH = "/sources";
const RETIRED_PUBLIC_SOURCES_COMPONENT = "SourcesPage";
const SOURCE_MANIFEST_ROUTE_PATH = "/analyst/sources";
const SOURCE_MANIFEST_COMPONENT = "AnalystSourcesPage";
const ANALYST_HOME_COMPONENT = "AnalystHomePage";
const ANALYST_HOME_LINKS_IDENTIFIER = "ANALYST_HOME_LINKS";
const ANALYST_NAVIGATION_IDENTIFIER = "ANALYST_NAV_ITEMS";
const VISITOR_NAVIGATION_IDENTIFIER = "VISITOR_NAV_ITEMS";
const LAYOUT_COMPONENT = "AppShell";
const NAVIGATION_ITEMS_ATTRIBUTE = "navigationItems";
/** The analyst Shared Navigation entry; it must exist only in the Analyst Build. */
const ANALYST_NAVIGATION_LABEL = "分析状態";
const ANALYST_NAVIGATION_PATH = "/analyst/readiness";

const PUBLIC_ROUTE_PATHS = Object.freeze([
  "/",
  "/schedule",
  "/candidates",
  "/candidates/:candidateId",
  "/comparison",
  "/venue",
  // 価値観診断（案B。regional-values-map tasks.md 14 の承認記録）
  "/values",
]);

const EXISTING_ANALYST_ROUTE_PATHS = Object.freeze([
  "/analyst/readiness",
  "/analyst/sources",
  "/analyst/runs",
  "/analyst/runs/:runId",
  "/analyst/verification/:artifactId",
  "/analyst/review/:artifactId",
  "/analyst/evaluation",
  "/analyst/p0",
  "/analyst/aws",
]);

const WILDCARD_ROUTE_PATH = "*";

/** Evidence-bearing views and the embedded source-evidence field terms they must keep. */
const PUBLIC_EVIDENCE_COMPONENTS = Object.freeze([
  Object.freeze({
    modulePath: PUBLIC_PAGES_MODULE,
    component: "SchedulePage",
    fields: Object.freeze(["出典", "最終更新日"]),
  }),
  Object.freeze({
    modulePath: PUBLIC_PAGES_MODULE,
    component: "CandidatesPage",
    fields: Object.freeze(["出典", "最終更新日"]),
  }),
  Object.freeze({
    modulePath: PUBLIC_PAGES_MODULE,
    component: "CandidateDetailPage",
    fields: Object.freeze(["採用資料", "出典", "最終更新日"]),
  }),
  Object.freeze({
    modulePath: PUBLIC_PAGES_MODULE,
    component: "ComparisonPage",
    fields: Object.freeze(["根拠リンク"]),
  }),
]);

const ANALYST_EVIDENCE_COMPONENTS = Object.freeze([
  Object.freeze({
    modulePath: ANALYST_PAGES_MODULE,
    component: SOURCE_MANIFEST_COMPONENT,
    fields: Object.freeze([
      "資料版",
      "revision",
      "source checksum",
      "利用条件確認状態",
      "採否理由",
    ]),
  }),
  Object.freeze({
    modulePath: ANALYST_PAGES_MODULE,
    component: "AnalystVerificationPage",
    fields: Object.freeze(["対応原文", "根拠引用", "locator"]),
  }),
  Object.freeze({
    modulePath: ANALYST_PAGES_MODULE,
    component: "AnalystReviewPage",
    fields: Object.freeze(["原文", "locator"]),
  }),
]);

/** Repository contract modules that define source evidence and provenance. */
const SOURCE_CONTRACT_MODULES = Object.freeze([
  Object.freeze({
    path: "packages/contracts/src/models/sources.ts",
    exports: Object.freeze([
      "LocatorSchema",
      "SourceReferenceSchema",
      "SourceManifestRecordSchema",
      "ProvenanceSchema",
    ]),
  }),
  Object.freeze({
    path: "packages/contracts/src/models/policy.ts",
    exports: Object.freeze(["CitationSchema"]),
  }),
]);

/** Browser APIs that could let runtime input select or switch the Application Mode. */
const RUNTIME_MODE_IDENTIFIERS = Object.freeze(
  new Set([
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "useSearchParams",
    "URLSearchParams",
    "createSearchParams",
  ]),
);

/** Package-name tokens that indicate an authentication or authorization dependency. */
const AUTH_PACKAGE_TOKENS = Object.freeze(
  new Set([
    "amplify",
    "auth",
    "auth0",
    "clerk",
    "cognito",
    "firebase",
    "jose",
    "jsonwebtoken",
    "jwt",
    "keycloak",
    "login",
    "msal",
    "oauth",
    "oauth2",
    "oidc",
    "okta",
    "openid",
    "passport",
    "session",
    "supabase",
  ]),
);

export const BUILD_BOUNDARY_TARGETS = Object.freeze({
  visitor: Object.freeze({
    requestedMode: "visitor",
    viteMode: "production",
    applicationMode: "VISITOR",
    outputDirectory: "dist",
    routeEntryPath: "src/app/visitor/routes.tsx",
    routePaths: Object.freeze([...PUBLIC_ROUTE_PATHS, WILDCARD_ROUTE_PATH]),
    navigationItems: Object.freeze({
      identifier: VISITOR_NAVIGATION_IDENTIFIER,
      modulePath: SHARED_SHELL_MODULE,
    }),
    evidenceComponents: PUBLIC_EVIDENCE_COMPONENTS,
  }),
  analyst: Object.freeze({
    requestedMode: "analyst",
    viteMode: "analyst",
    applicationMode: "ANALYST",
    outputDirectory: "dist-analyst",
    routeEntryPath: ANALYST_ROUTES_MODULE,
    routePaths: Object.freeze([
      ...PUBLIC_ROUTE_PATHS,
      ...EXISTING_ANALYST_ROUTE_PATHS,
      WILDCARD_ROUTE_PATH,
    ]),
    navigationItems: Object.freeze({
      identifier: ANALYST_NAVIGATION_IDENTIFIER,
      modulePath: ANALYST_NAVIGATION_MODULE,
    }),
    evidenceComponents: Object.freeze([
      ...PUBLIC_EVIDENCE_COMPONENTS,
      ...ANALYST_EVIDENCE_COMPONENTS,
    ]),
  }),
});

export function resolveBuildBoundaryTarget(requestedMode) {
  if (requestedMode === "visitor") {
    return BUILD_BOUNDARY_TARGETS.visitor;
  }
  if (requestedMode === "analyst") {
    return BUILD_BOUNDARY_TARGETS.analyst;
  }

  throw new Error('Build boundary mode must be exactly "visitor" or "analyst".');
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortedUnique(values) {
  return Object.freeze([...new Set(values)].sort());
}

function sameMembers(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function describeList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function packageNameFromSpecifier(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("\0") ||
    specifier.startsWith("node:") ||
    path.isAbsolute(specifier)
  ) {
    return null;
  }

  const segments = specifier.split("/");
  const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  return name === undefined || name === "" ? null : name;
}

/**
 * Converts a Rolldown module id into path-safe metadata: project files become
 * posix paths relative to the web root, dependencies become package names, and
 * virtual modules are dropped. Absolute paths never leave this function.
 */
export function normalizeModuleId(id, webRoot) {
  if (typeof id !== "string" || id === "" || id.startsWith("\0")) {
    return Object.freeze({ kind: "virtual" });
  }

  const withoutQuery = id.split("?", 1)[0] ?? "";
  const forwardSlashed = withoutQuery.replaceAll("\\", "/");
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = forwardSlashed.lastIndexOf(nodeModulesMarker);

  if (nodeModulesIndex !== -1) {
    const name = packageNameFromSpecifier(
      forwardSlashed.slice(nodeModulesIndex + nodeModulesMarker.length),
    );
    return name === null
      ? Object.freeze({ kind: "virtual" })
      : Object.freeze({ kind: "package", name });
  }

  if (!path.isAbsolute(withoutQuery)) {
    return Object.freeze({ kind: "virtual" });
  }

  const relativePath = path
    .relative(path.resolve(webRoot), path.resolve(withoutQuery))
    .split(path.sep)
    .join("/");
  return Object.freeze({ kind: "project", path: relativePath });
}

/**
 * Vite build plugin that emits the bundled module graph as real build metadata.
 * Each project module records its source hash, resolved imports, and the
 * exports that survived tree-shaking into the rendered chunk.
 */
export function createModuleManifestPlugin(webRoot) {
  return {
    name: "web-module-manifest",
    apply: "build",
    async generateBundle(_outputOptions, bundle) {
      const modules = new Map();
      const packages = new Set();

      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") {
          continue;
        }

        for (const moduleId of output.moduleIds) {
          const normalized = normalizeModuleId(moduleId, webRoot);
          if (normalized.kind === "package") {
            packages.add(normalized.name);
            continue;
          }
          if (normalized.kind !== "project") {
            continue;
          }

          const importedPaths = [];
          for (const importedId of this.getModuleInfo(moduleId)?.importedIds ?? []) {
            const imported = normalizeModuleId(importedId, webRoot);
            if (imported.kind === "project") {
              importedPaths.push(imported.path);
            } else if (imported.kind === "package") {
              importedPaths.push(`npm:${imported.name}`);
            }
          }

          const previous = modules.get(normalized.path);
          const source = await readFile(moduleId.split("?", 1)[0] ?? moduleId);
          modules.set(normalized.path, {
            path: normalized.path,
            sha256: sha256(source),
            importedPaths: sortedUnique([...(previous?.importedPaths ?? []), ...importedPaths]),
            renderedExports: sortedUnique([
              ...(previous?.renderedExports ?? []),
              ...(output.modules[moduleId]?.renderedExports ?? []),
            ]),
          });
        }
      }

      const manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        modules: [...modules.values()].sort((left, right) =>
          left.path.localeCompare(right.path),
        ),
        packages: sortedUnique(packages),
      };

      this.emitFile({
        type: "asset",
        fileName: WEB_MODULE_MANIFEST_FILENAME,
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPathSafeRelativePath(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value)
  );
}

/** Strictly decodes a module manifest; any unknown field or malformed entry fails closed. */
export function parseWebModuleManifest(value) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, MANIFEST_KEYS) ||
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(value.modules) ||
    !isStringArray(value.packages)
  ) {
    return null;
  }

  const modules = [];
  for (const entry of value.modules) {
    if (
      !isPlainObject(entry) ||
      !hasExactKeys(entry, MANIFEST_MODULE_KEYS) ||
      !isPathSafeRelativePath(entry.path) ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256) ||
      !isStringArray(entry.importedPaths) ||
      !isStringArray(entry.renderedExports)
    ) {
      return null;
    }

    modules.push(
      Object.freeze({
        path: entry.path,
        sha256: entry.sha256,
        importedPaths: Object.freeze([...entry.importedPaths]),
        renderedExports: Object.freeze([...entry.renderedExports]),
      }),
    );
  }

  if (new Set(modules.map((entry) => entry.path)).size !== modules.length) {
    return null;
  }

  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    modules: Object.freeze(modules),
    packages: Object.freeze([...value.packages]),
  });
}

function scriptKindFor(fileName) {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (/\.[cm]?ts$/u.test(fileName)) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

function parseSourceFile(fileName, sourceText) {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
}

function normalizeText(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function hasExportModifier(statement) {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function exportedDeclarationNames(statement) {
  if (!hasExportModifier(statement)) {
    return [];
  }
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return [statement.name?.text ?? "default"];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }
  if (
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return [statement.name.text];
  }
  return [];
}

function readImportBindings(statement) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return [];
  }

  const specifier = statement.moduleSpecifier.text;
  const clause = statement.importClause;
  if (clause === undefined) {
    return [{ local: null, imported: null, specifier, typeOnly: false }];
  }

  const bindings = [];
  if (clause.name !== undefined) {
    bindings.push({
      local: clause.name.text,
      imported: "default",
      specifier,
      typeOnly: clause.isTypeOnly,
    });
  }

  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    bindings.push({ local: named.name.text, imported: "*", specifier, typeOnly: clause.isTypeOnly });
  }
  if (named !== undefined && ts.isNamedImports(named)) {
    for (const element of named.elements) {
      bindings.push({
        local: element.name.text,
        imported: (element.propertyName ?? element.name).text,
        specifier,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
      });
    }
  }
  return bindings;
}

function jsxAttributeName(attribute, sourceFile) {
  return attribute.name.getText(sourceFile);
}

/** Returns the bare identifier of `{identifier}`; any literal or computed expression is `null`. */
function jsxIdentifierValue(initializer) {
  if (
    initializer !== undefined &&
    ts.isJsxExpression(initializer) &&
    initializer.expression !== undefined &&
    ts.isIdentifier(initializer.expression)
  ) {
    return initializer.expression.text;
  }
  return null;
}

/**
 * Static facts about one bundled module, collected from its TypeScript AST.
 * Type-only syntax is skipped so only runtime values are compared.
 */
function analyzeModuleSource(fileName, sourceText) {
  const sourceFile = parseSourceFile(fileName, sourceText);
  const importBindings = [];
  const exportedNames = new Set();
  const declaredNames = new Set();
  const identifiers = new Set();
  const jsxElementNames = new Set();
  const runtimeStrings = new Set();
  const runtimeModeSources = new Set();
  const navigationItemsValues = [];

  for (const statement of sourceFile.statements) {
    importBindings.push(...readImportBindings(statement));
    for (const name of exportedDeclarationNames(statement)) {
      exportedNames.add(name);
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedNames.add(element.name.text);
        identifiers.add((element.propertyName ?? element.name).text);
      }
    }
    if (ts.isExportAssignment(statement)) {
      exportedNames.add("default");
    }
  }

  const visit = (node) => {
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node)
    ) {
      return;
    }

    if (ts.isIdentifier(node)) {
      identifiers.add(node.text);
      if (RUNTIME_MODE_IDENTIFIERS.has(node.text)) {
        runtimeModeSources.add(node.text);
      }
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isFunctionExpression(node)) &&
      node.name !== undefined
    ) {
      declaredNames.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declaredNames.add(node.name.text);
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      jsxElementNames.add(node.tagName.getText(sourceFile));
    } else if (
      ts.isJsxAttribute(node) &&
      jsxAttributeName(node, sourceFile) === NAVIGATION_ITEMS_ATTRIBUTE
    ) {
      navigationItemsValues.push(jsxIdentifierValue(node.initializer));
    } else if (isStringLike(node)) {
      runtimeStrings.add(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (node.text.trim() !== "") {
        runtimeStrings.add(node.text);
      }
    } else if (ts.isJsxText(node)) {
      const text = normalizeText(node.text);
      if (text !== "") {
        runtimeStrings.add(text);
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const property = node.name.text;
      if (ts.isMetaProperty(node.expression) && property === "env") {
        runtimeModeSources.add("import.meta.env");
      } else if (property === "cookie") {
        runtimeModeSources.add("document.cookie");
      } else if (
        (property === "search" || property === "hash") &&
        /location$/iu.test(node.expression.getText(sourceFile))
      ) {
        runtimeModeSources.add(`location.${property}`);
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return {
    importBindings,
    exportedNames,
    declaredNames,
    identifiers,
    jsxElementNames,
    runtimeStrings,
    runtimeModeSources,
    navigationItemsValues,
  };
}

function routeOpeningElement(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "Route") {
    return node.openingElement;
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "Route") {
    return node;
  }
  return undefined;
}

const NON_LITERAL = Symbol("non-literal");

function readJsxAttributes(opening, sourceFile) {
  const attributes = new Map();

  for (const property of opening.attributes.properties) {
    if (!ts.isJsxAttribute(property)) {
      attributes.set("...", NON_LITERAL);
      continue;
    }

    const name = jsxAttributeName(property, sourceFile);
    const initializer = property.initializer;
    if (initializer === undefined) {
      attributes.set(name, true);
    } else if (ts.isStringLiteral(initializer)) {
      attributes.set(name, initializer.text);
    } else if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) {
      const expression = initializer.expression;
      if (isStringLike(expression)) {
        attributes.set(name, expression.text);
      } else if (ts.isIdentifier(expression)) {
        attributes.set(name, { kind: "identifier", name: expression.text });
      } else if (ts.isJsxSelfClosingElement(expression) || ts.isJsxElement(expression)) {
        const elementOpening = ts.isJsxElement(expression) ? expression.openingElement : expression;
        attributes.set(name, {
          kind: "element",
          component: elementOpening.tagName.getText(sourceFile),
          props: readJsxAttributes(elementOpening, sourceFile),
        });
      } else {
        attributes.set(name, NON_LITERAL);
      }
    } else {
      attributes.set(name, NON_LITERAL);
    }
  }

  return attributes;
}

function routePathFromSegments(segments) {
  if (segments.length === 0) {
    return "/";
  }
  if (segments.length === 1 && segments[0] === WILDCARD_ROUTE_PATH) {
    return WILDCARD_ROUTE_PATH;
  }
  return `/${segments.join("/")}`;
}

function splitRouteSegments(routePath) {
  return routePath.split("/").filter((segment) => segment !== "");
}

/**
 * Extracts normalized React Router descriptors from a route entry's JSX.
 * Nested paths are joined (`analyst/sources` -> `/analyst/sources`), index
 * routes resolve to their parent path, and non-literal paths become `null`.
 */
export function extractRouteDescriptors(fileName, sourceText) {
  const sourceFile = parseSourceFile(fileName, sourceText);
  const layouts = [];
  const routes = [];

  const collect = (node, parentSegments) => {
    const opening = routeOpeningElement(node);
    if (opening === undefined) {
      ts.forEachChild(node, (child) => collect(child, parentSegments));
      return;
    }

    const attributes = readJsxAttributes(opening, sourceFile);
    const pathValue = attributes.get("path");
    const element = attributes.get("element");
    const elementValue =
      typeof element === "object" && element !== null && element.kind === "element"
        ? element
        : null;
    const component = elementValue?.component ?? null;
    const childRoutes = ts.isJsxElement(node)
      ? node.children.filter((child) => routeOpeningElement(child) !== undefined)
      : [];

    if (attributes.has("...") || (pathValue !== undefined && typeof pathValue !== "string")) {
      routes.push(Object.freeze({ path: null, index: false, component }));
      return;
    }

    const segments =
      typeof pathValue === "string"
        ? [...parentSegments, ...splitRouteSegments(pathValue)]
        : parentSegments;

    if (childRoutes.length > 0) {
      const navigationItems = elementValue?.props.get(NAVIGATION_ITEMS_ATTRIBUTE);
      layouts.push(
        Object.freeze({
          path: typeof pathValue === "string" ? routePathFromSegments(segments) : null,
          component,
          navigationItems:
            typeof navigationItems === "object" &&
            navigationItems !== null &&
            navigationItems.kind === "identifier"
              ? navigationItems.name
              : null,
        }),
      );
      for (const child of childRoutes) {
        collect(child, segments);
      }
      return;
    }

    const index = attributes.get("index") === true;
    routes.push(
      Object.freeze({
        path: routePathFromSegments(index ? parentSegments : segments),
        index,
        component,
      }),
    );
  };

  collect(sourceFile, []);
  return Object.freeze({ layouts: Object.freeze(layouts), routes: Object.freeze(routes) });
}

/**
 * Extracts the analyst Home labels, descriptions, and section text from the
 * analyst page module so a Visitor Build can be checked for their absence.
 */
export function extractAnalystHomeTexts(fileName, sourceText) {
  const sourceFile = parseSourceFile(fileName, sourceText);
  const texts = new Set();

  const collectJsxText = (node) => {
    if (ts.isJsxText(node)) {
      const text = normalizeText(node.text);
      if (text !== "") {
        texts.add(text);
      }
    }
    ts.forEachChild(node, collectJsxText);
  };

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === ANALYST_HOME_LINKS_IDENTIFIER &&
      node.initializer !== undefined
    ) {
      const links = unwrapExpression(node.initializer);
      if (ts.isArrayLiteralExpression(links)) {
        for (const element of links.elements) {
          const link = unwrapExpression(element);
          if (!ts.isObjectLiteralExpression(link)) {
            continue;
          }
          for (const property of link.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
              (property.name.text === "label" || property.name.text === "description") &&
              isStringLike(property.initializer)
            ) {
              texts.add(property.initializer.text);
            }
          }
        }
      }
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === ANALYST_HOME_COMPONENT &&
      node.body !== undefined
    ) {
      collectJsxText(node.body);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return Object.freeze([...texts].sort());
}

function stripModuleExtension(modulePath) {
  return modulePath.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

function resolveImportedModule(importerPath, specifier, importedPaths) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const target = stripModuleExtension(
    path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier)),
  );
  return importedPaths.find((candidate) => stripModuleExtension(candidate) === target) ?? null;
}

/**
 * Normalizes a route descriptor or string literal to the pathname React Router
 * would match: surrounding whitespace, query, hash, and trailing slashes are
 * dropped and case is folded. Comparisons on the result are exact, so
 * `/sources` never matches `/analyst/sources`.
 */
function normalizedRoutePathname(value) {
  const pathname = value.trim().split(/[?#]/u, 1)[0] ?? "";
  const withoutTrailingSlash = pathname.replace(/\/+$/u, "");
  return (withoutTrailingSlash === "" && pathname !== "" ? "/" : withoutTrailingSlash).toLowerCase();
}

function isRetiredPublicSourcesPath(value) {
  return normalizedRoutePathname(value) === RETIRED_PUBLIC_SOURCES_PATH;
}

function isAnalystRoutePath(value) {
  const normalized = normalizedRoutePathname(value);
  return normalized === "/analyst" || normalized.startsWith("/analyst/");
}

function isAnalystNavigationLabel(value) {
  return normalizeText(value) === ANALYST_NAVIGATION_LABEL;
}

function isAuthPackageName(name) {
  return name
    .toLowerCase()
    .split(/[@/._-]+/u)
    .some((token) => AUTH_PACKAGE_TOKENS.has(token));
}

function evaluateRouteEntry({ target, modulesByPath, analyses, sources }, violations) {
  const routeSource = sources.get(target.routeEntryPath);
  const routeAnalysis = analyses.get(target.routeEntryPath);
  const routeModule = modulesByPath.get(target.routeEntryPath);
  if (routeSource === undefined || routeAnalysis === undefined || routeModule === undefined) {
    violations.push(`${target.routeEntryPath}: selected route entry is not bundled`);
    return;
  }

  const { layouts, routes } = extractRouteDescriptors(target.routeEntryPath, routeSource);
  const routePaths = routes.map((route) => route.path);

  if (routePaths.includes(null)) {
    violations.push(`${target.routeEntryPath}: registers a route with a non-literal path`);
  }
  if (!sameMembers(routePaths, target.routePaths)) {
    violations.push(
      `${target.routeEntryPath}: route descriptors ${describeList(routePaths)} ` +
        `do not equal ${describeList(target.routePaths)}`,
    );
  }
  for (const routePath of routePaths) {
    if (routePath !== null && isRetiredPublicSourcesPath(routePath)) {
      violations.push(
        `${target.routeEntryPath}: registers the retired public route descriptor ${RETIRED_PUBLIC_SOURCES_PATH}`,
      );
    }
    if (routePath !== null && target.applicationMode === "VISITOR" && isAnalystRoutePath(routePath)) {
      violations.push(
        `${target.routeEntryPath}: registers the Existing Analyst Route ${routePath} in the Visitor Build`,
      );
    }
  }

  const expectedNavigation = target.navigationItems;
  const [layout] = layouts;
  if (
    layouts.length !== 1 ||
    layout?.path !== null ||
    layout.component !== LAYOUT_COMPONENT ||
    layout.navigationItems !== expectedNavigation.identifier
  ) {
    const found = layouts
      .map((candidate) => `${candidate.component ?? "(none)"}:${candidate.navigationItems ?? "(non-identifier)"}`)
      .join(", ");
    violations.push(
      `${target.routeEntryPath}: expected one ${LAYOUT_COMPONENT} layout whose ` +
        `${NAVIGATION_ITEMS_ATTRIBUTE} is ${expectedNavigation.identifier} imported from ` +
        `${expectedNavigation.modulePath}; found [${found}]`,
    );
  } else {
    // The identifier must be the expected export of the expected module, not a
    // local, aliased, or runtime-derived value that happens to share its name.
    const binding = routeAnalysis.importBindings.find(
      (candidate) => candidate.local === expectedNavigation.identifier && !candidate.typeOnly,
    );
    const resolvedPath =
      binding === undefined
        ? null
        : resolveImportedModule(target.routeEntryPath, binding.specifier, routeModule.importedPaths);
    const navigationModule =
      resolvedPath === null ? undefined : modulesByPath.get(resolvedPath);

    if (
      binding === undefined ||
      binding.imported !== expectedNavigation.identifier ||
      resolvedPath !== expectedNavigation.modulePath ||
      navigationModule === undefined
    ) {
      violations.push(
        `${target.routeEntryPath}: ${expectedNavigation.identifier} is not imported from ` +
          `the bundled ${expectedNavigation.modulePath}`,
      );
    } else if (
      !navigationModule.renderedExports.includes(expectedNavigation.identifier) ||
      analyses.get(expectedNavigation.modulePath)?.exportedNames.has(expectedNavigation.identifier) !== true
    ) {
      violations.push(
        `${expectedNavigation.modulePath}: ${expectedNavigation.identifier} is not exported and rendered into the bundle`,
      );
    }
  }

  const componentModules = new Map();
  for (const descriptor of [...layouts, ...routes]) {
    if (descriptor.component === null) {
      violations.push(`${target.routeEntryPath}: route ${descriptor.path ?? "(non-literal)"} has no element`);
      continue;
    }

    const binding = routeAnalysis.importBindings.find(
      (candidate) => candidate.local === descriptor.component && !candidate.typeOnly,
    );
    const resolvedPath =
      binding === undefined
        ? null
        : resolveImportedModule(target.routeEntryPath, binding.specifier, routeModule.importedPaths);
    const resolvedModule = resolvedPath === null ? undefined : modulesByPath.get(resolvedPath);

    if (binding === undefined || resolvedModule === undefined) {
      violations.push(
        `${target.routeEntryPath}: ${descriptor.component} is not imported from a bundled module`,
      );
      continue;
    }
    if (!resolvedModule.renderedExports.includes(binding.imported)) {
      violations.push(
        `${resolvedModule.path}: ${binding.imported} is not rendered into the bundle`,
      );
    }
    componentModules.set(descriptor.component, resolvedModule.path);
  }

  if (target.applicationMode === "ANALYST") {
    const sourceManifestRoute = routes.find((route) => route.path === SOURCE_MANIFEST_ROUTE_PATH);
    if (
      sourceManifestRoute?.component !== SOURCE_MANIFEST_COMPONENT ||
      componentModules.get(SOURCE_MANIFEST_COMPONENT) !== ANALYST_PAGES_MODULE
    ) {
      violations.push(
        `${target.routeEntryPath}: ${SOURCE_MANIFEST_ROUTE_PATH} must render ` +
          `${SOURCE_MANIFEST_COMPONENT} from ${ANALYST_PAGES_MODULE}`,
      );
    }
  }
}

/**
 * Evaluates one build's module manifest and bundled sources against the mode
 * boundary. Returns human-readable violations; an empty list means the build
 * satisfies every checked boundary.
 */
export function evaluateBuildBoundary({
  target,
  manifest,
  sources,
  analystHomeTexts,
  webDependencies,
}) {
  const violations = [];
  const modulesByPath = new Map(manifest.modules.map((entry) => [entry.path, entry]));
  const projectPaths = [...modulesByPath.keys()];
  const analyses = new Map();

  for (const modulePath of projectPaths) {
    if (!ANALYZABLE_SOURCE_PATTERN.test(modulePath)) {
      continue;
    }
    const sourceText = sources.get(modulePath);
    if (sourceText === undefined) {
      violations.push(`${modulePath}: bundled source is not available for static analysis`);
      continue;
    }
    analyses.set(modulePath, analyzeModuleSource(modulePath, sourceText));
  }

  for (const required of REQUIRED_APP_MODULES) {
    if (!modulesByPath.has(required)) {
      violations.push(`${required}: required application module is not bundled`);
    }
  }

  const routeEntries = projectPaths.filter((modulePath) => ROUTE_ENTRY_PATTERN.test(modulePath));
  if (!sameMembers(routeEntries, [target.routeEntryPath])) {
    violations.push(
      `bundled route entries ${describeList(routeEntries)} do not equal ["${target.routeEntryPath}"]`,
    );
  }
  const appRouteImports = (modulesByPath.get("src/App.tsx")?.importedPaths ?? []).filter(
    (modulePath) => ROUTE_ENTRY_PATTERN.test(modulePath),
  );
  if (!sameMembers(appRouteImports, [target.routeEntryPath])) {
    violations.push(
      `src/App.tsx imports route entries ${describeList(appRouteImports)} ` +
        `instead of the explicit "${target.routeEntryPath}" entry`,
    );
  }

  evaluateRouteEntry({ target, modulesByPath, analyses, sources }, violations);

  for (const [modulePath, analysis] of analyses) {
    if (
      analysis.declaredNames.has(RETIRED_PUBLIC_SOURCES_COMPONENT) ||
      analysis.exportedNames.has(RETIRED_PUBLIC_SOURCES_COMPONENT) ||
      analysis.jsxElementNames.has(RETIRED_PUBLIC_SOURCES_COMPONENT) ||
      analysis.identifiers.has(RETIRED_PUBLIC_SOURCES_COMPONENT) ||
      analysis.importBindings.some(
        (binding) =>
          binding.local === RETIRED_PUBLIC_SOURCES_COMPONENT ||
          binding.imported === RETIRED_PUBLIC_SOURCES_COMPONENT,
      )
    ) {
      violations.push(`${modulePath}: references the retired public ${RETIRED_PUBLIC_SOURCES_COMPONENT}`);
    }
  }
  for (const entry of manifest.modules) {
    if (entry.renderedExports.includes(RETIRED_PUBLIC_SOURCES_COMPONENT)) {
      violations.push(`${entry.path}: renders the retired public ${RETIRED_PUBLIC_SOURCES_COMPONENT}`);
    }
  }

  for (const evidence of target.evidenceComponents) {
    const evidenceModule = modulesByPath.get(evidence.modulePath);
    if (evidenceModule === undefined) {
      violations.push(`${evidence.modulePath}: evidence-bearing module is not bundled`);
      continue;
    }
    if (!evidenceModule.renderedExports.includes(evidence.component)) {
      violations.push(`${evidence.modulePath}: ${evidence.component} is not rendered into the bundle`);
    }
    const strings = analyses.get(evidence.modulePath)?.runtimeStrings ?? new Set();
    const missing = evidence.fields.filter((field) => !strings.has(field));
    if (missing.length > 0) {
      violations.push(
        `${evidence.modulePath}: ${evidence.component} lost embedded source-evidence fields ${describeList(missing)}`,
      );
    }
  }

  for (const modulePath of projectPaths) {
    if (modulePath.startsWith(BUILD_CONFIG_MODULE_PREFIX)) {
      violations.push(`${modulePath}: build-time mode configuration is bundled into the web app`);
    }
  }
  for (const [modulePath, analysis] of analyses) {
    for (const source of analysis.runtimeModeSources) {
      violations.push(`${modulePath}: uses runtime mode source ${source}`);
    }
    for (const value of analysis.navigationItemsValues) {
      if (value === null) {
        violations.push(`${modulePath}: ${NAVIGATION_ITEMS_ATTRIBUTE} is not a bare identifier`);
      } else if (value !== target.navigationItems.identifier) {
        violations.push(
          `${modulePath}: ${NAVIGATION_ITEMS_ATTRIBUTE} is ${value} in the ${target.applicationMode} build; ` +
            `expected ${target.navigationItems.identifier}`,
        );
      }
    }
    for (const value of analysis.runtimeStrings) {
      if (isRetiredPublicSourcesPath(value)) {
        violations.push(
          `${modulePath}: contains the retired public destination ${JSON.stringify(value)}`,
        );
      }
    }
  }

  const packageNames = new Set([...manifest.packages, ...webDependencies]);
  for (const analysis of analyses.values()) {
    for (const binding of analysis.importBindings) {
      const name = packageNameFromSpecifier(binding.specifier);
      if (name !== null) {
        packageNames.add(name);
      }
    }
  }
  for (const name of [...packageNames].sort()) {
    if (isAuthPackageName(name)) {
      violations.push(`auth dependency ${name} is part of the web build`);
    }
  }

  if (target.applicationMode === "VISITOR") {
    for (const modulePath of projectPaths) {
      if (modulePath.startsWith(ANALYST_MODULE_PREFIX)) {
        violations.push(`${modulePath}: analyst module is bundled into the Visitor Build`);
      }
    }
    if (analystHomeTexts.length === 0) {
      violations.push(`${ANALYST_PAGES_MODULE}: analyst Home reference content could not be extracted`);
    }
    for (const [modulePath, analysis] of analyses) {
      for (const text of analystHomeTexts) {
        if (analysis.runtimeStrings.has(text)) {
          violations.push(`${modulePath}: contains analyst Home content ${JSON.stringify(text)}`);
        }
      }
      for (const value of analysis.runtimeStrings) {
        if (value.trim().toLowerCase() === "analyst") {
          violations.push(`${modulePath}: contains the runtime mode token ${JSON.stringify(value)}`);
        }
        if (isAnalystRoutePath(value)) {
          violations.push(
            `${modulePath}: contains the analyst route string ${JSON.stringify(value)} in the Visitor Build`,
          );
        }
        if (isAnalystNavigationLabel(value)) {
          violations.push(
            `${modulePath}: contains the analyst navigation label ${JSON.stringify(value)} in the Visitor Build`,
          );
        }
      }
    }
  } else {
    for (const required of [ANALYST_ROUTES_MODULE, ANALYST_PAGES_MODULE, ANALYST_NAVIGATION_MODULE]) {
      if (!modulesByPath.has(required)) {
        violations.push(`${required}: analyst module is missing from the Analyst Build`);
      }
    }
    const analystPages = modulesByPath.get(ANALYST_PAGES_MODULE);
    for (const component of [ANALYST_HOME_COMPONENT, SOURCE_MANIFEST_COMPONENT]) {
      if (analystPages !== undefined && !analystPages.renderedExports.includes(component)) {
        violations.push(`${ANALYST_PAGES_MODULE}: ${component} is not rendered into the Analyst Build`);
      }
    }
    const analystStrings = analyses.get(ANALYST_PAGES_MODULE)?.runtimeStrings ?? new Set();
    if (analystHomeTexts.length === 0 || analystHomeTexts.some((text) => !analystStrings.has(text))) {
      violations.push(`${ANALYST_PAGES_MODULE}: analyst Home content is incomplete in the Analyst Build`);
    }
    // Keeps the Visitor label/path exclusion tied to the entry the Analyst Build really ships.
    const navigationStrings = analyses.get(ANALYST_NAVIGATION_MODULE)?.runtimeStrings ?? new Set();
    if (!navigationStrings.has(ANALYST_NAVIGATION_LABEL) || !navigationStrings.has(ANALYST_NAVIGATION_PATH)) {
      violations.push(
        `${ANALYST_NAVIGATION_MODULE}: the analyst navigation entry ` +
          `${JSON.stringify(ANALYST_NAVIGATION_LABEL)} -> ${ANALYST_NAVIGATION_PATH} is missing from the Analyst Build`,
      );
    }
  }

  return Object.freeze(violations);
}

/** Checks that the source evidence and provenance contract modules still export their schemas. */
export function evaluateSourceContractModules(sources) {
  const violations = [];

  for (const contract of SOURCE_CONTRACT_MODULES) {
    const sourceText = sources.get(contract.path);
    if (sourceText === undefined) {
      violations.push(`${contract.path}: source evidence contract module is missing`);
      continue;
    }

    const { exportedNames } = analyzeModuleSource(contract.path, sourceText);
    const missing = contract.exports.filter((name) => !exportedNames.has(name));
    if (missing.length > 0) {
      violations.push(`${contract.path}: no longer exports ${describeList(missing)}`);
    }
  }

  return Object.freeze(violations);
}

function isInsideOrEqual(parentPath, candidatePath) {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
  );
}

/** Rejects output roots that would overwrite repository files such as `apps/web/dist`. */
export function assertIsolatedOutputRoot(outputRoot, repositoryRoot) {
  if (isInsideOrEqual(repositoryRoot, outputRoot)) {
    throw new Error(
      "The build boundary output root must be outside the repository so dist and dist-analyst are never overwritten.",
    );
  }
}

async function prepareOutputRoot(outputRoot) {
  try {
    const existing = await stat(outputRoot);
    if (!existing.isDirectory() || (await readdir(outputRoot)).length > 0) {
      throw new Error("The build boundary output root must be a new or empty directory.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    await mkdir(outputRoot, { recursive: true });
  }
}

function repositoryRootOf(webRoot) {
  return path.resolve(webRoot, "..", "..");
}

async function loadBoundaryReference(webRoot) {
  const analystPages = await readFile(path.join(webRoot, ANALYST_PAGES_MODULE), "utf8");
  const webPackage = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8"));
  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];

  return {
    analystHomeTexts: extractAnalystHomeTexts(ANALYST_PAGES_MODULE, analystPages),
    webDependencies: dependencyFields.flatMap((field) =>
      isPlainObject(webPackage[field]) ? Object.keys(webPackage[field]) : [],
    ),
  };
}

/**
 * Inspects one build artifact below `outputRoot`: the preview marker gate, the
 * strict module manifest, source integrity, and the mode boundary.
 */
export async function inspectBuildArtifact({ webRoot, outputRoot, requestedMode }) {
  const target = resolveBuildBoundaryTarget(requestedMode);
  const failed = (violations) =>
    Object.freeze({ target, moduleCount: 0, packages: Object.freeze([]), violations: Object.freeze(violations) });

  try {
    await inspectPreviewBuild(outputRoot, requestedMode);
  } catch (error) {
    return failed([errorMessage(error)]);
  }

  let manifest = null;
  try {
    manifest = parseWebModuleManifest(
      JSON.parse(
        await readFile(
          path.join(outputRoot, target.outputDirectory, WEB_MODULE_MANIFEST_FILENAME),
          "utf8",
        ),
      ),
    );
  } catch {
    manifest = null;
  }
  if (manifest === null) {
    return failed([
      `the module manifest ${WEB_MODULE_MANIFEST_FILENAME} in "${target.outputDirectory}" is missing or invalid`,
    ]);
  }

  const violations = [];
  const sources = new Map();
  for (const entry of manifest.modules) {
    if (!ANALYZABLE_SOURCE_PATTERN.test(entry.path)) {
      continue;
    }
    try {
      const bytes = await readFile(path.resolve(webRoot, entry.path));
      if (sha256(bytes) === entry.sha256) {
        sources.set(entry.path, bytes.toString("utf8"));
      } else {
        violations.push(`${entry.path}: source changed after the build`);
      }
    } catch {
      violations.push(`${entry.path}: bundled source file is unavailable`);
    }
  }

  const reference = await loadBoundaryReference(webRoot);
  violations.push(
    ...evaluateBuildBoundary({ target, manifest, sources, ...reference }),
  );

  return Object.freeze({
    target,
    moduleCount: manifest.modules.length,
    packages: manifest.packages,
    violations: Object.freeze(violations),
  });
}

/** Builds both modes with the real Vite config into `outputRoot/dist` and `outputRoot/dist-analyst`. */
export async function buildBoundaryArtifacts({ webRoot, outputRoot }) {
  const { build } = await import("vite");

  for (const target of Object.values(BUILD_BOUNDARY_TARGETS)) {
    await build({
      root: webRoot,
      configFile: path.join(webRoot, "vite.config.ts"),
      mode: target.viteMode,
      logLevel: "warn",
      clearScreen: false,
      build: {
        outDir: path.join(outputRoot, target.outputDirectory),
        emptyOutDir: true,
      },
      plugins: [createModuleManifestPlugin(webRoot)],
    });
  }
}

async function readSourceContractModules(repositoryRoot) {
  const sources = new Map();
  for (const contract of SOURCE_CONTRACT_MODULES) {
    try {
      sources.set(contract.path, await readFile(path.join(repositoryRoot, contract.path), "utf8"));
    } catch {
      // A missing contract module is reported by evaluateSourceContractModules.
    }
  }
  return sources;
}

/**
 * Runs fresh Visitor and Analyst builds into an isolated output root, inspects
 * both artifacts and the source contract modules, and removes temporary output.
 */
export async function runBuildBoundaryCheck({ webRoot, outputRoot }) {
  const repositoryRoot = repositoryRootOf(webRoot);
  const ownsOutputRoot = outputRoot === undefined;
  const root = ownsOutputRoot
    ? await mkdtemp(path.join(tmpdir(), "ehime-build-boundary-"))
    : path.resolve(outputRoot);

  try {
    assertIsolatedOutputRoot(root, repositoryRoot);
    if (!ownsOutputRoot) {
      await prepareOutputRoot(root);
    }

    await buildBoundaryArtifacts({ webRoot, outputRoot: root });

    const artifacts = [];
    for (const target of Object.values(BUILD_BOUNDARY_TARGETS)) {
      artifacts.push(
        await inspectBuildArtifact({ webRoot, outputRoot: root, requestedMode: target.requestedMode }),
      );
    }
    const sourceContractViolations = evaluateSourceContractModules(
      await readSourceContractModules(repositoryRoot),
    );

    return Object.freeze({
      ok:
        artifacts.every((artifact) => artifact.violations.length === 0) &&
        sourceContractViolations.length === 0,
      artifacts: Object.freeze(artifacts),
      sourceContractViolations,
    });
  } finally {
    if (ownsOutputRoot) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

export function formatBuildBoundaryReport(report) {
  const lines = [];

  for (const artifact of report.artifacts) {
    const label = `${artifact.target.applicationMode} ${artifact.target.outputDirectory}`;
    if (artifact.violations.length === 0) {
      lines.push(
        `BUILD_BOUNDARY_OK ${label} modules=${artifact.moduleCount} packages=${artifact.packages.join(",")}`,
      );
    } else {
      for (const violation of artifact.violations) {
        lines.push(`BUILD_BOUNDARY_FAILED ${label}: ${violation}`);
      }
    }
  }

  if (report.sourceContractViolations.length === 0) {
    lines.push("BUILD_BOUNDARY_OK SOURCE_CONTRACTS");
  } else {
    for (const violation of report.sourceContractViolations) {
      lines.push(`BUILD_BOUNDARY_FAILED SOURCE_CONTRACTS: ${violation}`);
    }
  }

  lines.push(`BUILD_BOUNDARY_RESULT ${report.ok ? "PASS" : "FAIL"}`);
  return Object.freeze(lines);
}
