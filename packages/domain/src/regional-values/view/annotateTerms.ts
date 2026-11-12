import type { RichText } from "./viewTypes.js";

/** A registered technical term of an issue card, with its short explanation. */
export type GlossaryEntry = Readonly<{ term: string; description: string }>;

type Part = RichText[number];

function pushText(parts: Part[], value: string): void {
  if (value === "") {
    return;
  }
  const last = parts[parts.length - 1];
  if (last?.t === "text") {
    parts[parts.length - 1] = { t: "text", v: last.v + value };
  } else {
    parts.push({ t: "text", v: value });
  }
}

function annotateOne(text: string, glossary: readonly GlossaryEntry[], noted: Set<string>): RichText {
  const parts: Part[] = [];
  let rest = text;
  for (;;) {
    let best: Readonly<{ entry: GlossaryEntry; index: number }> | undefined;
    for (const entry of glossary) {
      const index = rest.indexOf(entry.term);
      if (index === -1) {
        continue;
      }
      // The earliest occurrence wins; at the same place the longer term wins.
      if (best === undefined || index < best.index || (index === best.index && entry.term.length > best.entry.term.length)) {
        best = { entry, index };
      }
    }
    if (best === undefined) {
      break;
    }
    const end = best.index + best.entry.term.length;
    if (noted.has(best.entry.term)) {
      // A term noted before stays plain, and so does a shorter term inside it.
      pushText(parts, rest.slice(0, end));
    } else {
      pushText(parts, rest.slice(0, best.index));
      parts.push({ t: "term", v: best.entry.term, description: best.entry.description });
      noted.add(best.entry.term);
    }
    rest = rest.slice(end);
  }
  pushText(parts, rest);
  return parts;
}

/**
 * Notes each registered term at its first occurrence on the screen only (Req 11.11).
 * `texts` are all the texts of one screen in reading order; a term noted in an earlier
 * text stays plain in the later ones. The parts joined back give the original text.
 * A term with an empty name is ignored.
 */
export function annotateTerms(texts: readonly string[], glossary: readonly GlossaryEntry[]): RichText[] {
  const usable = glossary.filter((entry) => entry.term !== "");
  const noted = new Set<string>();
  return texts.map((text) => annotateOne(text, usable, noted));
}