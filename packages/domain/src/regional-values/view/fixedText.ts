import {
  allowedPlaceholders,
  requiredFixedTextKeys,
  type DataKind,
  type FixedTextKey,
  type FixedTexts,
} from "@ehime-vote-navigator/contracts";

/**
 * Looking up and filling in the approved fixed texts. A bundle is checked to hold
 * every required key before it is used, so a missing key here is a defect and is
 * thrown, not hidden. The error names only the key and the placeholder, never a value.
 */

export type FixedTextValues = Readonly<Record<string, string | number>>;

type WithFixedTexts = Readonly<{ fixedTexts: FixedTexts }>;

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

/** The text of the key as it is approved, with its placeholders unfilled. */
export function lookupFixedText(bundle: WithFixedTexts, key: FixedTextKey): string {
  const item = bundle.fixedTexts.items.find((candidate) => candidate.key === key);
  if (item === undefined) {
    throw new Error(`The fixed text ${key} is missing`);
  }
  return item.text;
}

/**
 * The text of the key with its placeholders filled in. Each key allows a fixed set of
 * names (Req 5.12). A value for a name the key does not allow, and a placeholder of
 * the text without a value, are rejected. A value is filled in once and never read again.
 */
export function renderFixedText(
  bundle: WithFixedTexts,
  key: FixedTextKey,
  values: FixedTextValues = {},
): string {
  const text = lookupFixedText(bundle, key);
  const allowed = allowedPlaceholders(key);
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.includes(name)) {
      throw new Error(`The fixed text ${key} does not take the value ${name}`);
    }
    if (typeof value === "number" && !Number.isInteger(value)) {
      throw new RangeError(`The value ${name} for ${key} must be an integer`);
    }
  }
  return text.replace(PLACEHOLDER, (_whole: string, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`The fixed text ${key} needs the value ${name}`);
    }
    return String(values[name]);
  });
}

/** The required keys that the bundle does not hold, in the order of the closed list. */
export function missingFixedTextKeys(
  dataKind: DataKind,
  fixedTexts: FixedTexts,
): readonly FixedTextKey[] {
  const present = new Set<string>(fixedTexts.items.map((item) => item.key));
  return requiredFixedTextKeys(dataKind).filter((key) => !present.has(key));
}