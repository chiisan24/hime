/**
 * An encoder to Shift_JIS for the tests of the intake. The runtime has a decoder only (`TextDecoder`),
 * so the table of the encoder is made from the decoder: every two-byte code that decodes to one
 * character gives that character its bytes. A test can then write any fictional table in Shift_JIS,
 * and a character that the table cannot write is an error of the test, not a silent change.
 */

const LEAD_BYTES: readonly number[] = [
  ...Array.from({ length: 0x9f - 0x81 + 1 }, (_value, index) => 0x81 + index),
  ...Array.from({ length: 0xfc - 0xe0 + 1 }, (_value, index) => 0xe0 + index),
];

let table: ReadonlyMap<string, Uint8Array> | undefined;

function codeTable(): ReadonlyMap<string, Uint8Array> {
  if (table !== undefined) {
    return table;
  }
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const built = new Map<string, Uint8Array>();
  for (const lead of LEAD_BYTES) {
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      if (trail === 0x7f) {
        continue;
      }
      const bytes = Uint8Array.of(lead, trail);
      let character: string;
      try {
        character = decoder.decode(bytes);
      } catch {
        continue;
      }
      // The first code that gives a character is the one that is used (a few characters have two).
      if (Array.from(character).length === 1 && !built.has(character)) {
        built.set(character, bytes);
      }
    }
  }
  table = built;
  return built;
}

/** The bytes of the text in Shift_JIS. ASCII and half-width katakana are one byte. */
export function encodeShiftJis(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint >= 0xff61 && codePoint <= 0xff9f) {
      bytes.push(codePoint - 0xff61 + 0xa1);
    } else {
      const code = codeTable().get(character);
      if (code === undefined) {
        throw new Error(`The character U+${codePoint.toString(16)} has no Shift_JIS code`);
      }
      bytes.push(...code);
    }
  }
  return Uint8Array.from(bytes);
}

/** The bytes of the text in UTF-8, with the byte order mark when asked. */
export function encodeUtf8(text: string, withByteOrderMark = false): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!withByteOrderMark) {
    return body;
  }
  const marked = new Uint8Array(3 + body.length);
  marked.set([0xef, 0xbb, 0xbf], 0);
  marked.set(body, 3);
  return marked;
}
