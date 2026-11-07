import { useParams } from "react-router-dom";

import {
  CANDIDATE_SKELETONS,
  FeatureLinkGrid,
  FutureFieldList,
  PageIntro,
  StatusPanel,
  VisitorHomePage,
  type FeatureLink,
} from "../public/pages.js";

const ANALYST_HOME_LINKS: readonly FeatureLink[] = [
  {
    to: "/analyst/readiness",
    label: "解析準備状態を見る",
    description: "両候補者の資料不足を確認します。",
  },
  {
    to: "/analyst/sources",
    label: "Source Manifest画面を見る",
    description: "資料版と来歴の管理画面枠です。",
  },
  {
    to: "/analyst/runs",
    label: "解析実行と履歴を見る",
    description: "runは開始せず、未準備状態を確認します。",
  },
  {
    to: "/analyst/evaluation",
    label: "評価画面を見る",
    description: "評価結果の表示枠です。",
  },
  {
    to: "/analyst/p0",
    label: "P0完成判定を見る",
    description: "P0検査と未達項目の表示枠です。",
  },
  {
    to: "/analyst/aws",
    label: "AWS診断画面を見る",
    description: "読み取り診断の結果表示枠です。",
  },
];

export function AnalystHomePage() {
  return (
    <>
      <VisitorHomePage />
      <section aria-labelledby="analyst-links-heading" className="mt-10">
        <h2 className="text-2xl font-bold text-ink" id="analyst-links-heading">
          ローカル分析のP0画面
        </h2>
        <p className="mt-2 text-ink-soft">
          共同開発者向けの画面枠です。実資料へのアクセスやAWS要求は、この画面表示では実行しません。
        </p>
        <FeatureLinkGrid links={ANALYST_HOME_LINKS} />
      </section>
    </>
  );
}

export function AnalystReadinessPage() {
  return (
    <div>
      <PageIntro
        description="Source Manifestと両候補者の同等資料範囲を確認する分析画面枠です。"
        eyebrow="ローカル分析"
        title="政策解析準備状態"
      />
      <StatusPanel statusCode="NOT_READY" title="両候補者の政策一次資料が不足しています">
        <div className="grid gap-3 sm:grid-cols-2">
          {CANDIDATE_SKELETONS.map((candidate) => (
            <section className="rounded-xl border border-accent/30 bg-white p-4" key={candidate.candidateId}>
              <h3 className="font-bold">{candidate.name}</h3>
              <p className="mt-2">不足項目: 2022年の採用可能な政策一次資料</p>
            </section>
          ))}
        </div>
      </StatusPanel>
    </div>
  );
}

export function AnalystSourcesPage() {
  return (
    <div>
      <PageIntro
        description="Source Manifestの資料版、checksum、利用条件、採否を扱う画面枠です。"
        eyebrow="ローカル分析"
        title="Source Manifest"
      />
      <StatusPanel statusCode="no-data" title="登録済みの実政策資料はありません">
        <p>資料版の登録操作とAPI接続はTask 5.1の対象外です。</p>
        <FutureFieldList fields={["資料版", "候補者", "対象選挙", "revision", "source checksum", "利用条件確認状態", "採否理由"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystRunsPage() {
  return (
    <div>
      <PageIntro
        description="資料版の選択、解析開始、queue、実行履歴を扱う画面枠です。"
        eyebrow="ローカル分析"
        title="解析実行と履歴"
      />
      <StatusPanel statusCode="NOT_READY" title="解析runは開始できません">
        <p>政策解析準備状態がNOT_READYのため、run開始操作を置かず、疑似進捗も表示しません。</p>
      </StatusPanel>
    </div>
  );
}

export function AnalystRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const stages = [
    "取り込み",
    "分割",
    "検索",
    "構造化抽出",
    "要約",
    "決定的検査",
    "Bedrock意味判定",
  ] as const;

  return (
    <div>
      <PageIntro
        description="1件のrunについて固定順の7段階、結果、失敗理由、費用を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="解析run詳細"
      />
      {runId === undefined ? null : (
        <p className="mt-6 text-sm text-ink-soft">
          run ID: <code className="break-all font-mono">{runId}</code>
        </p>
      )}
      <StatusPanel statusCode="no-data" title="一致する実行履歴はありません">
        <p>runは実行していません。以下は進捗ではなく、今後表示する段階名です。</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="今後表示する解析段階">
          {stages.map((stage, index) => (
            <li className="rounded-lg border border-line bg-white px-4 py-3" key={stage}>
              <span className="font-semibold">{index + 1}. {stage}</span>
              <span className="ml-2 font-mono text-sm text-ink-soft">no-data</span>
            </li>
          ))}
        </ol>
      </StatusPanel>
    </div>
  );
}

export function AnalystVerificationPage() {
  const { artifactId } = useParams<{ artifactId: string }>();

  return (
    <div>
      <PageIntro
        description="原文、引用、決定的検査、別要求の意味判定を同じartifactに結び付ける画面枠です。"
        eyebrow="ローカル分析"
        title="根拠検証"
      />
      {artifactId === undefined ? null : (
        <p className="mt-6 text-sm text-ink-soft">
          artifact ID: <code className="break-all font-mono">{artifactId}</code>
        </p>
      )}
      <StatusPanel statusCode="no-data" title="検証対象artifactはありません">
        <FutureFieldList fields={["対応原文", "根拠引用", "locator", "決定的検査", "Bedrock意味判定", "自動状態", "状態決定理由"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystReviewPage() {
  const { artifactId } = useParams<{ artifactId: string }>();

  return (
    <div>
      <PageIntro
        description="原文と検証結果を照合し、人間状態を判断する画面枠です。"
        eyebrow="ローカル分析"
        title="人間確認"
      />
      {artifactId === undefined ? null : (
        <p className="mt-6 text-sm text-ink-soft">
          artifact ID: <code className="break-all font-mono">{artifactId}</code>
        </p>
      )}
      <StatusPanel statusCode="no-data" title="確認対象artifactはありません">
        <p>承認条件を満たす実データがないため、承認・却下操作は表示しません。</p>
        <FutureFieldList fields={["対象選挙", "候補者", "原文", "locator", "構造化政策情報", "初心者向け要約", "検証結果", "人間状態"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystEvaluationPage() {
  return (
    <div>
      <PageIntro
        description="gold datasetによる検証あり・なしの評価結果を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="評価"
      />
      <StatusPanel statusCode="no-data" title="評価結果はありません">
        <p>実資料と評価datasetがないため、指標、時間、費用の数値を生成しません。</p>
        <FutureFieldList fields={["dataset版", "除外例", "指標の分子・分母・値", "所要時間", "概算費用", "設定"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystP0Page() {
  return (
    <div>
      <PageIntro
        description="P0検査、証跡、完成期限の判定結果を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="P0完成判定"
      />
      <StatusPanel statusCode="NOT_READY" title="P0未完成です">
        <p>両候補者の実政策資料、実AI実行、検証、人間承認などの証跡が未達です。fixtureや画面枠を完成証跡として扱いません。</p>
      </StatusPanel>
    </div>
  );
}

export function AnalystAwsPage() {
  return (
    <div>
      <PageIntro
        description="AWS既定認証チェーン、東京リージョン、3用途modelの読み取り診断を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="AWS診断"
      />
      <StatusPanel statusCode="no-data" title="AWS診断は実行していません">
        <p>この画面表示によるAWS要求は0件です。診断操作とAPI接続はTask 5.1の対象外です。</p>
        <FutureFieldList fields={["認証可否", "呼出主体の安全な識別結果", "設定リージョン", "生成model", "意味判定model", "埋め込みmodel"]} />
      </StatusPanel>
    </div>
  );
}
