import {
  FixedTextSchema,
  allowedPlaceholders,
  requiredFixedTextKeys,
  type DataKind,
  type FixedTextKey,
  type FixedTexts,
} from "@ehime-vote-navigator/contracts";

/**
 * Synthetic fixed texts for the tests of the view. Each text is the key in angle
 * brackets, so that a test can see which key a part of a view model came from. This
 * is not wording: the approved wording is made and approved separately.
 */

/** The keys whose builder always fills in every allowed name; the text then holds the placeholders. */
function holdsPlaceholders(key: FixedTextKey): boolean {
  return (
    key.startsWith("counts.") ||
    key === "about.thresholds" ||
    key.startsWith("about.coverage.") ||
    key.startsWith("license.")
  );
}

export function syntheticText(key: FixedTextKey): string {
  const names = holdsPlaceholders(key) ? allowedPlaceholders(key).map((name) => `{${name}}`) : [];
  return `〈${key}〉${names.join("")}`;
}

const APPROVAL = { status: "APPROVED", approverId: "test-approver", approvedAt: "2026-01-01T00:00:00Z" };

/**
 * One text for every key that the data kind requires. `omit` leaves keys out and
 * `texts` replaces the text of a key; both are for a test of a defect.
 */
export function syntheticFixedTexts(
  dataKind: DataKind,
  options: Readonly<{
    omit?: readonly FixedTextKey[];
    texts?: Readonly<Partial<Record<FixedTextKey, string>>>;
  }> = {},
): FixedTexts {
  const omit = new Set<string>(options.omit ?? []);
  const items = requiredFixedTextKeys(dataKind)
    .filter((key) => !omit.has(key))
    .map((key) =>
      FixedTextSchema.parse({ key, text: options.texts?.[key] ?? syntheticText(key), approval: APPROVAL }),
    );
  return { dataKind, items };
}