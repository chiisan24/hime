import { GATE_REASON_CLASS } from "@ehime-vote-navigator/contracts";
import type { GateFinding, NeutralityConfig, QuestionBank } from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { BALANCE_CHECK_IDS, checkBalance, type BalanceViolation } from "./balanceChecks.js";
import { TEXT_CHECK_IDS, checkQuestionTexts, type TextCheckViolation } from "./textChecks.js";

/**
 * Every check of the question bank, in definition order: the text checks of 8.3 and then the
 * balance, composition and approval checks of 8.4. A result lists the violations in this order,
 * and within one check in the order of the bank (questions, or diagnostic sets).
 */
export const BANK_CHECK_IDS = [...TEXT_CHECK_IDS, ...BALANCE_CHECK_IDS] as const;

export type BankCheckId = (typeof BANK_CHECK_IDS)[number];

/** A violation of one question (with its ID), or of one diagnostic set (with its kind and no question). */
export type BankViolation = TextCheckViolation | BalanceViolation;

/** The settings of the checks and the numbers and years of the fact items (a plain set, not the fact item type). */
export type InspectionContext = Readonly<{
  config: NeutralityConfig;
  factNumerals: ReadonlySet<string>;
}>;

export type BankInspectionError = Readonly<{ violations: readonly BankViolation[] }>;

/**
 * Runs every check and collects all violations (Req 3.12). With one violation or more it returns
 * the error and no value, so no part of a bundle can come from it. It does not change the bank,
 * it calls no AI, and it returns the same result for the same input.
 *
 * It reads the question kind, the question text and the diagnostic sets only. It has no
 * exemption by theme, data kind or author (Req 3.11), and no setting that skips a question.
 * All diagnostic sets of the bank are inspected, because a set that does not satisfy its
 * composition is refused whatever its kind. How a missing approval is treated for QUICK and for
 * FULL is decided where the bundle is assembled (9.2), not here: this function reports it.
 */
export function inspectQuestionBank(
  bank: QuestionBank,
  context: InspectionContext,
): Result<void, BankInspectionError> {
  const violations: BankViolation[] = [
    ...checkQuestionTexts(bank, context.config, context.factNumerals),
    ...checkBalance(bank, context.config),
  ];
  return violations.length === 0 ? { ok: true, value: undefined } : { ok: false, error: { violations } };
}

/**
 * The finding that a violation becomes in the build report. A finding has a code, its class and a
 * stable target ID, and never the text of the question (Req 7.19, 10.16).
 *
 * - a missing or outdated approval is a `SHORTAGE` (it can be supplied): `QUESTION_NOT_APPROVED`;
 * - a set that breaks its composition is a `DEFECT`: `SET_COMPOSITION_INVALID`;
 * - every other check is a `DEFECT`: `NEUTRALITY_VIOLATION`.
 */
export function toGateFinding(violation: BankViolation): GateFinding {
  const target =
    "setKind" in violation
      ? ({ targetKind: "DIAGNOSTIC_SET", targetId: violation.setKind } as const)
      : ({ targetKind: "QUESTION", targetId: violation.questionId } as const);
  if (violation.check === "REVIEW_APPROVAL") {
    return { code: "QUESTION_NOT_APPROVED", class: GATE_REASON_CLASS.QUESTION_NOT_APPROVED, ...target };
  }
  if (violation.check === "SET_COMPOSITION") {
    return { code: "SET_COMPOSITION_INVALID", class: GATE_REASON_CLASS.SET_COMPOSITION_INVALID, ...target };
  }
  return { code: "NEUTRALITY_VIOLATION", class: GATE_REASON_CLASS.NEUTRALITY_VIOLATION, ...target };
}
