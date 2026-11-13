import { GATE_REASON_CLASS } from "@ehime-vote-navigator/contracts";
import type { GateFinding, GateReasonCode } from "@ehime-vote-navigator/contracts";

export type GateTargetKind = GateFinding["targetKind"];

/**
 * A finding of a content check: a reason code, its class and the stable ID of the target. It
 * never carries the text of a card, a fact or a sentence (Req 7.19, 10.16).
 */
export function gateFinding(code: GateReasonCode, targetKind: GateTargetKind, targetId: string | null): GateFinding {
  return { code, class: GATE_REASON_CLASS[code], targetKind, targetId };
}
