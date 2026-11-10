/**
 * Rough counts of PDF building blocks, found by scanning the raw bytes. They only
 * help to judge whether a page is mostly pictures or uses fonts without a
 * Unicode map. Objects inside compressed object streams are not seen.
 */
export type PdfStructureHints = Readonly<{
  cidFonts: number;
  compressedObjectStreams: number;
  encrypted: boolean;
  fonts: number;
  images: number;
  toUnicodeMaps: number;
  type0Fonts: number;
}>;

export function scanPdfStructure(bytes: Uint8Array): PdfStructureHints {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const count = (pattern: RegExp): number => text.match(pattern)?.length ?? 0;

  return {
    cidFonts: count(/\/Subtype\s*\/CIDFontType[02]\b/gu),
    compressedObjectStreams: count(/\/Type\s*\/ObjStm\b/gu),
    encrypted: /\/Encrypt\b/u.test(text),
    fonts: count(/\/Type\s*\/Font\b/gu),
    images: count(/\/Subtype\s*\/Image\b/gu),
    toUnicodeMaps: count(/\/ToUnicode\b/gu),
    type0Fonts: count(/\/Subtype\s*\/Type0\b/gu),
  };
}