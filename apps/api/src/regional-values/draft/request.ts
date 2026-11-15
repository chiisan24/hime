import {
  DataKindSchema,
  DraftTaskSchema,
  EvidenceUnitSchema,
  FactItemSchema,
  QuestionSchema,
  RegionalSourceSchema,
  ThemeIdSchema,
} from "@ehime-vote-navigator/contracts";
import { z } from "zod";

/**
 * What a person asks of the draft process: the task and the material. The material is the fact
 * items and the quotations with the records of their sources, so a request is the whole input; it
 * has no field for an answer of a user, the priority theme, the values map or a free text of a
 * user (Req 8.3). A key that is not in the schema is refused, because the object is strict.
 */

export const QUESTION_DRAFT_KINDS = ["IMPORTANCE", "TRADEOFF", "PRIORITY_PICK"] as const;

const TOPIC_MAX_CHARS = 200;

export const DraftRequestSchema = z
  .object({
    task: DraftTaskSchema,
    dataKind: DataKindSchema,
    /** The fact items that an issue candidate rests on. */
    facts: z.array(FactItemSchema).max(20),
    /** Every fact item of the data kind, to find the operands of a derived fact. Without it, the facts of the input. */
    factRegistry: z.array(FactItemSchema).max(200).optional(),
    /** The quotations that a card rests on. */
    evidence: z.array(EvidenceUnitSchema).max(20),
    /** The records of the sources of the facts and the quotations. */
    sources: z.array(RegionalSourceSchema).max(40),
    /** What the issue is about, in a few words. It is put in the material, not in the instruction. */
    topic: z.string().min(1).max(TOPIC_MAX_CHARS).optional(),
    themeId: ThemeIdSchema.optional(),
    /** QUESTION_DRAFT: the form of the question. */
    questionKind: z.enum(QUESTION_DRAFT_KINDS).optional(),
    /** NEUTRALITY_REVIEW: the question to review. */
    question: QuestionSchema.optional(),
    /** NEUTRALITY_REVIEW: the model that drafted the question, which must not be the model of the second opinion. */
    draftModelId: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const need = (field: keyof typeof request, present: boolean): void => {
      if (present && request[field] === undefined) {
        context.addIssue({ code: "custom", message: `${request.task} needs ${field}`, path: [field] });
      }
    };
    if (request.task === "QUESTION_DRAFT") {
      need("questionKind", true);
      need("themeId", request.questionKind === "IMPORTANCE" || request.questionKind === "TRADEOFF");
    }
    if (request.task === "NEUTRALITY_REVIEW") {
      need("question", true);
    }
    const ids = new Set<string>();
    request.evidence.forEach((unit, index) => {
      if (ids.has(unit.evidenceId)) {
        context.addIssue({ code: "custom", message: "evidenceId must be unique within one input", path: ["evidence", index, "evidenceId"] });
      }
      ids.add(unit.evidenceId);
    });
  });

export type DraftRequest = z.infer<typeof DraftRequestSchema>;
