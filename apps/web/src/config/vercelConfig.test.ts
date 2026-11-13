import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * Vercel の SPA フォールバック設定（vercel.json）の確認。
 * React Router の画面（/values、/schedule など）を直接開いたり再読み込みしたりしても、
 * 404 にならず index.html を返すようにする。
 * Vercel のプロジェクトの Root Directory がリポジトリのルートか apps/web かを確認できていないため、
 * 両方に同じ内容を置いている（Vercel は Root Directory にある vercel.json だけを読む）。
 */

const WEB_ROOT = new URL("../../", import.meta.url);
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);

type Rewrite = Readonly<{ source: string; destination: string }>;
type VercelConfig = Readonly<{ rewrites?: readonly Rewrite[] }>;

async function readConfig(root: URL): Promise<VercelConfig> {
  const text = await readFile(fileURLToPath(new URL("vercel.json", root)), "utf8");
  return JSON.parse(text) as VercelConfig;
}

/**
 * Vercel の source（path-to-regexp の書式）のうち、この設定で使う「/(正規表現)」の形だけを JS の正規表現にする。
 * Vercel は、実在する静的ファイル（/assets/*.js など）を rewrites より先に返す。
 */
function sourceToRegExp(source: string): RegExp {
  const match = /^\/\((.*)\)$/u.exec(source);
  if (match === null) {
    throw new Error(`Unsupported rewrite source: ${source}`);
  }
  return new RegExp(`^/(${match[1] ?? ""})$`, "u");
}

describe("Vercel の SPA フォールバック設定", () => {
  it("リポジトリのルートと apps/web に同じ設定がある", async () => {
    expect(await readConfig(REPOSITORY_ROOT)).toEqual(await readConfig(WEB_ROOT));
  });

  it("画面のURLを index.html に書き換え、/api/ は書き換えない", async () => {
    const config = await readConfig(WEB_ROOT);
    expect(config.rewrites).toHaveLength(1);
    const [rewrite] = config.rewrites ?? [];
    expect(rewrite?.destination).toBe("/index.html");
    const pattern = sourceToRegExp(rewrite?.source ?? "");

    for (const path of [
      "/",
      "/values",
      "/values/",
      "/schedule",
      "/candidates",
      "/candidates/nakamura-tokihiro",
      "/comparison",
      "/venue",
      "/not-a-p0-route",
    ]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/api/health", "/api/sessions/1"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
