import { describe, expect, it } from "vitest";

import * as contract from "./index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ELECTION_ID = "ehime-governor-2022-20";
const CANDIDATE_ID = "candidate-contract-example";
const SOURCE_ID = "source-contract-example";
const REVISION = "revision-1";
const ARTIFACT_ID = "artifact-1";
const RUN_ID = "run-1";
const INSTANT = "2026-01-01T00:00:00.000Z";
const END_INSTANT = "2026-01-01T00:00:01.000Z";

const locator = {
  kind: "text-lines",
  startLine: 1,
  endLine: 1,
};

const provenance = {
  electionId: ELECTION_ID,
  candidateId: CANDIDATE_ID,
  sourceId: SOURCE_ID,
  revision: REVISION,
  sourceChecksum: HASH_A,
};

const structuredPolicy = {
  target: null,
  content: null,
  conditions: null,
  exceptions: null,
  negation: null,
  implementationStage: null,
  deadline: null,
  evidenceQuote: null,
  locator: null,
};

const deterministicCheck = {
  checkId: "check-1",
  artifactId: ARTIFACT_ID,
  kind: "QUOTE_EXISTS",
  outcome: "UNVERIFIABLE",
  inputIds: ["input-1"],
  reasonCode: "INPUT_NOT_AVAILABLE",
  safeReason: "契約検証用の安全な理由",
};

const semanticCheck = {
  checkId: "semantic-check-1",
  artifactId: ARTIFACT_ID,
  requestId: null,
  modelId: "verification-model",
  promptVersion: "semantic-v1",
  meaningChange: "UNDETERMINED",
  meaningReversal: "UNDETERMINED",
  unsupportedAddition: "UNDETERMINED",
  safeReasons: ["契約検証用の安全な理由"],
};

const promptVersions = {
  extraction: "extraction-v1",
  summary: "summary-v1",
  semantic: "semantic-v1",
};

const modelIds = {
  generation: "generation-model",
  verification: "verification-model",
  embedding: "embedding-model",
};

const retrievalConfig = {
  version: "retrieval-v1",
  normalizerVersion: "normalizer-v1",
  ngramSizes: [2, 3],
  bm25: { k1: 1.2, b: 0.75 },
  keywordThreshold: 0,
  cosineThreshold: 0,
  thresholdInclusive: true,
  rrfK: 60,
  topK: 5,
  tieBreak: [
    "rrf-desc",
    "keyword-desc",
    "cosine-desc",
    "policy-unit-key-asc",
  ],
};

const citation = {
  ...provenance,
  citationId: "citation-1",
  locator,
  quote: "契約検証用の非政策テキスト",
  policyUnitId: "policy-unit-1",
};

const aiArtifact = {
  ...provenance,
  artifactId: ARTIFACT_ID,
  dataKind: "REAL_AI",
  runId: RUN_ID,
  policyUnitId: "policy-unit-1",
  structured: structuredPolicy,
  beginnerSummary: "契約検証用の要約",
  citations: [citation],
  deterministicChecks: [deterministicCheck],
  semanticCheck,
  automaticStatus: "REVIEW",
  humanStatus: "PENDING",
  promptVersions,
  modelIds,
  artifactContentHash: HASH_B,
  createdAt: INSTANT,
};

const approvalSnapshot = {
  ...provenance,
  structured: structuredPolicy,
  beginnerSummary: "契約検証用の要約",
  promptVersions,
  modelIds,
  artifactContentHash: HASH_B,
  automaticStatus: "PASS",
};

const pendingStages = [
  { name: "INGESTION", ordinal: 1 },
  { name: "SEGMENTATION", ordinal: 2 },
  { name: "RETRIEVAL", ordinal: 3 },
  { name: "STRUCTURED_EXTRACTION", ordinal: 4 },
  { name: "SUMMARY", ordinal: 5 },
  { name: "DETERMINISTIC_VERIFICATION", ordinal: 6 },
  { name: "SEMANTIC_VERIFICATION", ordinal: 7 },
].map(({ name, ordinal }) => ({
  name,
  ordinal,
  status: "PENDING",
  startedAt: null,
  endedAt: null,
  resultArtifactIds: [],
  errorClassification: null,
  lifecycleCode: null,
  safeReason: null,
}));

const modelUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  unit: "TOKENS",
  unavailableReason: "利用量は返されませんでした",
};

const modelRequestCost = {
  requestId: "request-1",
  purpose: "GENERATION",
  modelId: "generation-model",
  attempt: 1,
  startedAt: INSTANT,
  endedAt: END_INSTANT,
  usage: modelUsage,
  priceTableVersion: "pricing-v1",
  formula: null,
  estimatedCost: null,
  unavailableReason: "単価がありません",
};

const evaluationExpectation = {
  citation: "契約検証用の非政策テキスト",
  structured: structuredPolicy,
  publishable: false,
  categories: ["INSUFFICIENT_EVIDENCE"],
};

const evaluationExample = {
  ...provenance,
  exampleId: "example-1",
  locator,
  expected: evaluationExpectation,
  reviewerResults: [
    {
      reviewerId: "reviewer-1",
      matchedOriginal: true,
      fieldResults: { citation: true },
    },
  ],
};

const evaluationConfiguration = {
  modelIds,
  awsRegion: "ap-northeast-1",
  promptVersions,
  retrievalConfigHash: HASH_A,
};

interface SchemaLike {
  safeParse(value: unknown): { success: boolean };
}

interface StrictObjectCase {
  name: string;
  schema: SchemaLike;
  value: Record<string, unknown>;
}

const strictObjectCases: readonly StrictObjectCase[] = [
  {
    name: "Election",
    schema: contract.ElectionSchema,
    value: {
      electionId: ELECTION_ID,
      name: "令和4年（2022年）第20回愛媛県知事選挙",
      electionDate: "2022-11-20",
      timeZone: "Asia/Tokyo",
      sourceIds: [SOURCE_ID],
      lastUpdated: "2026-01-01",
    },
  },
  {
    name: "CandidateNameEvidence",
    schema: contract.CandidateNameEvidenceSchema,
    value: {
      displayedName: "中村時広",
      sourceSpelling: "中村時広",
      sourceId: SOURCE_ID,
    },
  },
  {
    name: "CandidateResult",
    schema: contract.CandidateResultSchema,
    value: { votes: 1, sourceId: SOURCE_ID },
  },
  {
    name: "CandidatePhoto",
    schema: contract.CandidatePhotoSchema,
    value: {
      kind: "placeholder",
      placeholderId: "neutral-person-placeholder",
    },
  },
  {
    name: "Candidate",
    schema: contract.CandidateSchema,
    value: {
      candidateId: CANDIDATE_ID,
      electionId: ELECTION_ID,
      canonicalName: "中村時広",
      nameEvidence: [
        {
          displayedName: "中村時広",
          sourceSpelling: "中村時広",
          sourceId: SOURCE_ID,
        },
      ],
      affiliation: null,
      result: null,
      career: null,
      sourceIds: [SOURCE_ID],
      lastUpdated: "2026-01-01",
      photo: {
        kind: "placeholder",
        placeholderId: "neutral-person-placeholder",
      },
    },
  },
  {
    name: "PdfPageLocator",
    schema: contract.LocatorSchema,
    value: { kind: "pdf-page", page: 1 },
  },
  {
    name: "HtmlParagraphLocator",
    schema: contract.LocatorSchema,
    value: { kind: "html-paragraph", headings: ["見出し"], paragraph: 1 },
  },
  { name: "TextLinesLocator", schema: contract.LocatorSchema, value: locator },
  {
    name: "UsageReview",
    schema: contract.UsageReviewSchema,
    value: {
      status: "UNKNOWN",
      checkedAt: "2026-01-01",
      checkedTarget: "契約検証対象",
      evidence: "契約検証用の根拠",
    },
  },
  {
    name: "SourceReference",
    schema: contract.SourceReferenceSchema,
    value: { kind: "url", url: "https://example.invalid/source" },
  },
  {
    name: "OcrHumanReview",
    schema: contract.OcrHumanReviewSchema,
    value: {
      reviewerId: "reviewer-1",
      reviewedAt: INSTANT,
      matchedOriginal: true,
      originalSourceId: SOURCE_ID,
      originalRevision: REVISION,
    },
  },
  {
    name: "SourceManifestRecord",
    schema: contract.SourceManifestRecordSchema,
    value: {
      dataKind: "REAL_AI",
      sourceId: SOURCE_ID,
      revision: REVISION,
      electionId: ELECTION_ID,
      candidateId: null,
      issuer: "契約検証用発行者",
      title: "構造検証用ダミー（実資料ではない）",
      sourceType: "official-result",
      reference: { kind: "url", url: "https://example.invalid/source" },
      rawSnapshotRelativePath: "contract-example/source.txt",
      publishedAt: "2022-11-20",
      retrievedAt: "2026-01-01",
      usage: {
        status: "UNKNOWN",
        checkedAt: "2026-01-01",
        checkedTarget: "契約検証対象",
        evidence: "契約検証用の根拠",
      },
      sourceChecksum: HASH_A,
      electionCorrespondenceEvidence: "契約検証用の対応根拠",
      adoptionRuleVersion: "policy-v1",
      adoptionDecision: "EXCLUDED",
      adoptionReason: "構造検証専用で実資料ではないため",
    },
  },
  { name: "Provenance", schema: contract.ProvenanceSchema, value: provenance },
  {
    name: "ExtractedSegment",
    schema: contract.ExtractedSegmentSchema,
    value: {
      ...provenance,
      segmentId: "segment-1",
      locator,
      text: "契約検証用の非政策テキスト",
      textSha256: HASH_B,
      extractorVersion: "extractor-v1",
    },
  },
  {
    name: "PolicyUnit",
    schema: contract.PolicyUnitSchema,
    value: {
      ...provenance,
      policyUnitId: "policy-unit-1",
      locator,
      originalText: "契約検証用の非政策テキスト",
      originalTextSha256: HASH_B,
      segmentId: "segment-1",
      segmenterVersion: "segmenter-v1",
      dataKind: "REAL_AI",
    },
  },
  {
    name: "RetrievalFilter",
    schema: contract.RetrievalFilterSchema,
    value: {
      electionId: ELECTION_ID,
      candidateId: CANDIDATE_ID,
      revision: REVISION,
    },
  },
  {
    name: "RetrievalConfig",
    schema: contract.RetrievalConfigSchema,
    value: retrievalConfig,
  },
  {
    name: "RetrievalHit",
    schema: contract.RetrievalHitSchema,
    value: {
      ...provenance,
      policyUnitId: "policy-unit-1",
      policyUnitKey: "policy-unit-key-1",
      locator,
      originalText: "契約検証用の非政策テキスト",
      keywordScore: null,
      keywordRank: null,
      cosineSimilarity: null,
      semanticRank: null,
      rrfScore: 0,
      finalRank: 1,
      retrievalConfigHash: HASH_A,
      embeddingModelId: "embedding-model",
    },
  },
  {
    name: "Negation",
    schema: contract.NegationSchema,
    value: { target: "対象", statement: "否定表現" },
  },
  {
    name: "StructuredPolicy",
    schema: contract.StructuredPolicySchema,
    value: structuredPolicy,
  },
  { name: "Citation", schema: contract.CitationSchema, value: citation },
  {
    name: "DeterministicCheck",
    schema: contract.DeterministicCheckSchema,
    value: deterministicCheck,
  },
  {
    name: "SemanticCheck",
    schema: contract.SemanticCheckSchema,
    value: semanticCheck,
  },
  {
    name: "VerificationRecord",
    schema: contract.VerificationRecordSchema,
    value: {
      verificationId: "verification-1",
      artifactId: ARTIFACT_ID,
      deterministic: [deterministicCheck],
      semantic: semanticCheck,
      automaticStatus: "REVIEW",
      decisionReasonCodes: ["INPUT_NOT_AVAILABLE"],
      createdAt: INSTANT,
    },
  },
  {
    name: "PromptVersions",
    schema: contract.PromptVersionsSchema,
    value: promptVersions,
  },
  { name: "ModelIds", schema: contract.ModelIdsSchema, value: modelIds },
  { name: "AiArtifact", schema: contract.AiArtifactSchema, value: aiArtifact },
  {
    name: "ApprovalSnapshot",
    schema: contract.ApprovalSnapshotSchema,
    value: approvalSnapshot,
  },
  {
    name: "ApprovalRecord",
    schema: contract.ApprovalRecordSchema,
    value: {
      decision: "APPROVED",
      approvalId: "approval-1",
      artifactId: ARTIFACT_ID,
      approverId: "reviewer-1",
      decidedAt: INSTANT,
      reason: "契約検証用の承認理由",
      snapshot: approvalSnapshot,
      approvalSnapshotHash: HASH_A,
      previousRecordHash: null,
    },
  },
  {
    name: "RejectionRecord",
    schema: contract.RejectionRecordSchema,
    value: {
      decision: "REJECTED",
      rejectionId: "rejection-1",
      artifactId: ARTIFACT_ID,
      approverId: "reviewer-1",
      decidedAt: INSTANT,
      reason: "契約検証用の却下理由",
      sourceChecksum: HASH_A,
      revision: REVISION,
      previousRecordHash: null,
    },
  },
  {
    name: "RunStage",
    schema: contract.RunStageSchema,
    value: pendingStages[0] as Record<string, unknown>,
  },
  { name: "ModelUsage", schema: contract.ModelUsageSchema, value: modelUsage },
  {
    name: "EstimatedCost",
    schema: contract.EstimatedCostSchema,
    value: { currency: "USD", amount: "0.001" },
  },
  {
    name: "ModelRequestCost",
    schema: contract.ModelRequestCostSchema,
    value: modelRequestCost,
  },
  {
    name: "AnalysisRun",
    schema: contract.AnalysisRunSchema,
    value: {
      ...provenance,
      runId: RUN_ID,
      dataKind: "REAL_AI",
      dedupeKey: HASH_B,
      status: "QUEUED",
      stages: pendingStages,
      promptVersions,
      modelIds,
      awsProfile: "default",
      awsRegion: "ap-northeast-1",
      crossRegionInference: false,
      retrievalConfig,
      retrievalConfigHash: HASH_A,
      priceTableVersion: "pricing-v1",
      createdAt: INSTANT,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      requests: [],
      safeDiagnostics: [],
    },
  },
  {
    name: "EvaluationExpectation",
    schema: contract.EvaluationExpectationSchema,
    value: evaluationExpectation,
  },
  {
    name: "EvaluationReviewerResult",
    schema: contract.EvaluationReviewerResultSchema,
    value: {
      reviewerId: "reviewer-1",
      matchedOriginal: true,
      fieldResults: { citation: true },
    },
  },
  {
    name: "EvaluationExample",
    schema: contract.EvaluationExampleSchema,
    value: evaluationExample,
  },
  {
    name: "EvaluationDataset",
    schema: contract.EvaluationDatasetSchema,
    value: {
      datasetVersion: "dataset-v1",
      createdAt: INSTANT,
      examples: [evaluationExample],
      artifactSetId: "artifact-set-1",
      generationModelId: "generation-model",
      promptVersion: "generation-v1",
      retrievalConfigHash: HASH_A,
    },
  },
  {
    name: "RateMetric",
    schema: contract.RateMetricSchema,
    value: {
      numerator: 0,
      denominator: 0,
      value: null,
      unavailableReason: "ZERO_DENOMINATOR",
    },
  },
  {
    name: "ExcludedEvaluationExample",
    schema: contract.ExcludedEvaluationExampleSchema,
    value: { exampleId: "example-1", reasons: ["照合結果不一致"] },
  },
  {
    name: "EvaluationConfiguration",
    schema: contract.EvaluationConfigurationSchema,
    value: evaluationConfiguration,
  },
  {
    name: "EvaluationResult",
    schema: contract.EvaluationResultSchema,
    value: {
      evaluationId: "evaluation-1",
      datasetVersion: "dataset-v1",
      mode: "WITH_VERIFICATION",
      metrics: {
        citationMatch: {
          numerator: 0,
          denominator: 0,
          value: null,
          unavailableReason: "ZERO_DENOMINATOR",
        },
      },
      excludedExamples: [],
      startedAt: INSTANT,
      endedAt: END_INSTANT,
      durationMs: 1000,
      estimatedCost: null,
      configuration: evaluationConfiguration,
    },
  },
  {
    name: "ReadinessIssue",
    schema: contract.ReadinessIssueSchema,
    value: {
      candidateId: null,
      sourceId: null,
      revision: null,
      code: "MATERIAL_MISSING",
      fieldPaths: ["candidateId"],
      safeMessage: "契約検証用の安全な説明",
    },
  },
  {
    name: "ReadinessMaterial",
    schema: contract.ReadinessMaterialSchema,
    value: {
      sourceId: SOURCE_ID,
      revision: REVISION,
      title: "構造検証用ダミー（実資料ではない）",
      sourceType: "official-result",
      publishedAt: "2022-11-20",
      retrievedAt: "2026-01-01",
      usageStatus: "UNKNOWN",
      electionMatch: true,
    },
  },
  {
    name: "CandidateMaterialSummary",
    schema: contract.CandidateMaterialSummarySchema,
    value: { candidateId: CANDIDATE_ID, materials: [] },
  },
  {
    name: "ReadinessReport",
    schema: contract.ReadinessReportSchema,
    value: {
      status: "NOT_READY",
      evaluatedAt: INSTANT,
      adoptionRuleVersion: "policy-v1",
      candidateMaterialSummary: [
        { candidateId: CANDIDATE_ID, materials: [] },
      ],
      issues: [],
    },
  },
  {
    name: "PublicationDecision",
    schema: contract.PublicationDecisionSchema,
    value: {
      publishable: false,
      artifactId: ARTIFACT_ID,
      snapshotMatched: false,
      reasons: ["承認snapshot未一致"],
    },
  },
  {
    name: "MaterialVolume",
    schema: contract.MaterialVolumeSchema,
    value: {
      adoptedSourceCount: 0,
      extractedCodePointCount: 0,
      verifiedPolicyUnitCount: 0,
    },
  },
  {
    name: "PreReleaseCheck",
    schema: contract.PreReleaseCheckSchema,
    value: {
      kind: "COPYRIGHT",
      completed: false,
      reviewerId: null,
      checkedAt: null,
      checkedTarget: null,
      evidence: null,
    },
  },
  {
    name: "P0CheckItem",
    schema: contract.P0CheckItemSchema,
    value: {
      checkId: "check-1",
      outcome: "FAIL",
      safeMessage: "証跡が不足しています",
      evidenceUris: [],
    },
  },
  {
    name: "P0CheckResult",
    schema: contract.P0CheckResultSchema,
    value: {
      p0CheckId: "p0-check-1",
      checkedAtJst: "2026-01-01T09:00:00+09:00",
      status: "P0未完成",
      deadlineStatus: "完成日時なし",
      completionAtJst: null,
      items: [
        {
          checkId: "check-1",
          outcome: "FAIL",
          safeMessage: "証跡が不足しています",
          evidenceUris: [],
        },
      ],
    },
  },
  {
    name: "ApiRetry",
    schema: contract.ApiRetrySchema,
    value: { allowed: false, remaining: 0 },
  },
  {
    name: "ApiErrorDetail",
    schema: contract.ApiErrorDetailSchema,
    value: {
      code: "NOT_READY",
      message: "解析準備未完了です",
      retry: { allowed: false, remaining: 0 },
    },
  },
  {
    name: "ApiError",
    schema: contract.ApiErrorSchema,
    value: {
      ok: false,
      error: {
        code: "NOT_READY",
        message: "解析準備未完了です",
        retry: { allowed: false, remaining: 0 },
      },
      requestId: "request-1",
    },
  },
  {
    name: "ApiSuccess",
    schema: contract.createApiSuccessSchema(contract.ElectionSchema),
    value: {
      ok: true,
      data: {
        electionId: ELECTION_ID,
        name: "令和4年（2022年）第20回愛媛県知事選挙",
        electionDate: "2022-11-20",
        timeZone: "Asia/Tokyo",
        sourceIds: [SOURCE_ID],
        lastUpdated: "2026-01-01",
      },
      requestId: "request-1",
    },
  },
];

describe("P0 contract schemas", () => {
  for (const contractCase of strictObjectCases) {
    it(`accepts a valid ${contractCase.name} and rejects every missing required field`, () => {
      expect(contractCase.schema.safeParse(contractCase.value).success).toBe(true);

      for (const key of Object.keys(contractCase.value)) {
        const valueWithoutRequiredField = { ...contractCase.value };
        delete valueWithoutRequiredField[key];
        expect(
          contractCase.schema.safeParse(valueWithoutRequiredField).success,
          `${contractCase.name}.${key} must be required`,
        ).toBe(false);
      }
    });

    it(`rejects an unknown field on ${contractCase.name}`, () => {
      expect(
        contractCase.schema.safeParse({
          ...contractCase.value,
          unexpectedContractField: true,
        }).success,
      ).toBe(false);
    });
  }

  it("accepts explicit nulls but rejects missing nullable StructuredPolicy fields", () => {
    expect(contract.StructuredPolicySchema.safeParse(structuredPolicy).success).toBe(
      true,
    );

    const missingTarget = { ...structuredPolicy };
    delete (missingTarget as Partial<typeof structuredPolicy>).target;
    expect(contract.StructuredPolicySchema.safeParse(missingTarget).success).toBe(
      false,
    );
  });

  it("accepts a null candidateId but rejects a missing candidateId", () => {
    const sourceCase = strictObjectCases.find(
      ({ name }) => name === "SourceManifestRecord",
    );
    expect(sourceCase).toBeDefined();
    if (sourceCase === undefined) {
      return;
    }

    expect(sourceCase.schema.safeParse(sourceCase.value).success).toBe(true);
    const missingCandidateId = { ...sourceCase.value };
    delete missingCandidateId.candidateId;
    expect(sourceCase.schema.safeParse(missingCandidateId).success).toBe(false);
  });
});

describe("primitive and fixed-enum schemas", () => {
  it.each([
    [contract.DataKindSchema, "BOTH"],
    [contract.UsageStatusSchema, "ALLOWED"],
    [contract.ReadinessStatusSchema, "UNKNOWN"],
    [contract.AutomaticStatusSchema, "APPROVED"],
    [contract.HumanStatusSchema, "PASS"],
    [contract.ErrorClassificationSchema, "UPSTREAM_FAILURE"],
    [contract.ApiErrorCodeSchema, "RAW_ERROR"],
    [contract.SourceTypeSchema, "blog"],
    [contract.AdoptionDecisionSchema, "PENDING"],
    [contract.ImplementationStageSchema, "DONE"],
    [contract.DeterministicCheckOutcomeSchema, "UNKNOWN"],
    [contract.SemanticCheckOutcomeSchema, "PASS"],
    [contract.RunStageNameSchema, "PUBLICATION"],
    [contract.RunStageStatusSchema, "CANCELLED"],
    [contract.RunLifecycleCodeSchema, "RESTARTED"],
    [contract.ModelRequestPurposeSchema, "CHAT"],
    [contract.AnalysisRunStatusSchema, "PENDING"],
    [contract.EvaluationCategorySchema, "RANKING"],
    [contract.EvaluationModeSchema, "MIXED"],
    [contract.PreReleaseCheckKindSchema, "DEPLOYMENT"],
    [contract.P0StatusSchema, "P0候補"],
    [contract.DeadlineStatusSchema, "未判定"],
  ] as const)("rejects an out-of-contract enum value", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it.each([
    "2023-02-29",
    "2024-02-30",
    "2026-13-01",
    "2026-1-01",
    "0000-01-01",
  ])("rejects invalid ISO date %s", (value) => {
    expect(contract.ISODateSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    "2023-02-29T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00",
  ])("rejects invalid ISO instant %s", (value) => {
    expect(contract.ISOInstantSchema.safeParse(value).success).toBe(false);
  });

  it.each([HASH_A.toUpperCase(), "a".repeat(63), `${"a".repeat(63)}g`])(
    "rejects invalid lowercase SHA-256 %s",
    (value) => {
      expect(contract.Sha256Schema.safeParse(value).success).toBe(false);
    },
  );
});

describe("seven-stage run contract", () => {
  it("accepts exactly the seven stages in their fixed order", () => {
    expect(contract.RunStagesSchema.safeParse(pendingStages).success).toBe(true);
  });

  it("rejects a missing, reordered, or ordinal-mismatched stage", () => {
    expect(contract.RunStagesSchema.safeParse(pendingStages.slice(0, 6)).success).toBe(
      false,
    );

    const reordered = [
      pendingStages[1]!,
      pendingStages[0]!,
      ...pendingStages.slice(2),
    ];
    expect(contract.RunStagesSchema.safeParse(reordered).success).toBe(false);

    const wrongOrdinal = pendingStages.map((stage, index) =>
      index === 0 ? { ...stage, ordinal: 2 } : stage,
    );
    expect(contract.RunStagesSchema.safeParse(wrongOrdinal).success).toBe(false);
  });

  it("rejects more than one running stage", () => {
    const stages = pendingStages.map((stage, index) =>
      index < 2 ? { ...stage, status: "RUNNING" } : stage,
    );
    expect(contract.RunStagesSchema.safeParse(stages).success).toBe(false);
  });

  it("requires all stages after a failed stage to be skipped", () => {
    const invalidStages = pendingStages.map((stage, index) =>
      index === 2 ? { ...stage, status: "FAILED" } : stage,
    );
    expect(contract.RunStagesSchema.safeParse(invalidStages).success).toBe(false);

    const validStages = pendingStages.map((stage, index) => {
      if (index === 2) {
        return { ...stage, status: "FAILED" };
      }
      if (index > 2) {
        return { ...stage, status: "SKIPPED" };
      }
      return { ...stage, status: "SUCCEEDED" };
    });
    expect(contract.RunStagesSchema.safeParse(validStages).success).toBe(true);
  });
});

describe("API envelope contracts", () => {
  const envelopeSchema = contract.createApiEnvelopeSchema(contract.ElectionSchema);

  it("accepts success and error envelopes through one shared decoder", () => {
    const successCase = strictObjectCases.find(({ name }) => name === "ApiSuccess");
    const errorCase = strictObjectCases.find(({ name }) => name === "ApiError");
    expect(successCase).toBeDefined();
    expect(errorCase).toBeDefined();
    if (successCase === undefined || errorCase === undefined) {
      return;
    }

    expect(envelopeSchema.safeParse(successCase.value).success).toBe(true);
    expect(envelopeSchema.safeParse(errorCase.value).success).toBe(true);
  });

  it("rejects mixed and unknown envelope fields", () => {
    const errorCase = strictObjectCases.find(({ name }) => name === "ApiError");
    expect(errorCase).toBeDefined();
    if (errorCase === undefined) {
      return;
    }

    expect(
      envelopeSchema.safeParse({ ...errorCase.value, data: {} }).success,
    ).toBe(false);
  });
});
