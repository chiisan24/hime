import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { createPdfjsPageRasterizer } from "./pdfjsPageRasterizer.js";

// A tiny valid PDF with one 300 x 200 pt page and the fictional word "Hello" in large type.
function buildPdf(): Uint8Array {
  const stream = "BT /F1 60 Tf 20 80 Td (Hello) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

async function pixels(png: Uint8Array) {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, image.width, image.height).data, height: image.height, width: image.width };
}

describe("createPdfjsPageRasterizer", () => {
  it("renders a whole page at the requested resolution on an opaque white background", async () => {
    const result = await createPdfjsPageRasterizer().rasterize(buildPdf(), [{ dpi: 144, page: 1 }]);

    expect(result.ok).toBe(true);
    const image = result.ok ? result.value[0] : undefined;
    expect(image).toMatchObject({ dpi: 144, height: 400, page: 1, width: 600 });
    expect(image?.region).toEqual({ x0: 0, x1: 1, y0: 0, y1: 1 });
    expect([...(image?.png.subarray(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const { data } = await pixels(image?.png ?? new Uint8Array());
    expect([...data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 255) < 100) {
        dark += 1;
      }
    }
    expect(dark).toBeGreaterThan(200);
  });

  it("renders only the requested part and reports it in page coordinates", async () => {
    const result = await createPdfjsPageRasterizer().rasterize(buildPdf(), [
      { dpi: 144, page: 1, region: { x0: 0, x1: 0.5, y0: 0.25, y1: 0.75 } },
    ]);

    const image = result.ok ? result.value[0] : undefined;
    expect(image).toMatchObject({ height: 200, width: 300 });
    expect(image?.region).toEqual({ x0: 0, x1: 0.5, y0: 0.25, y1: 0.75 });
  });

  it("returns one image per request, in order, and never changes the input", async () => {
    const bytes = buildPdf();
    const before = Array.from(bytes);

    const result = await createPdfjsPageRasterizer().rasterize(bytes, [
      { dpi: 72, page: 1 },
      { dpi: 72, page: 1, region: { x0: 0, x1: 0.5, y0: 0, y1: 0.5 } },
    ]);

    expect(result.ok && result.value.map((image) => [image.width, image.height])).toEqual([
      [300, 200],
      [150, 100],
    ]);
    expect(Array.from(bytes)).toEqual(before);
  });

  it.each([
    ["page 0", [{ page: 0 }], "INVALID_REQUEST"],
    ["a fractional page", [{ page: 1.5 }], "INVALID_REQUEST"],
    ["dpi below the minimum", [{ dpi: 10, page: 1 }], "INVALID_REQUEST"],
    ["dpi above the maximum", [{ dpi: 1200, page: 1 }], "INVALID_REQUEST"],
    ["an inverted region", [{ page: 1, region: { x0: 0.6, x1: 0.4, y0: 0, y1: 1 } }], "INVALID_REGION"],
    ["a region outside the page", [{ page: 1, region: { x0: 0, x1: 1.2, y0: 0, y1: 1 } }], "INVALID_REGION"],
    ["a page past the end", [{ page: 2 }], "PAGE_OUT_OF_RANGE"],
  ])("rejects %s", async (_label, requests, code) => {
    const result = await createPdfjsPageRasterizer().rasterize(buildPdf(), requests);

    expect(result).toEqual({ ok: false, error: { code } });
  });

  it("reports data that is not a PDF as PDF_CORRUPT", async () => {
    const result = await createPdfjsPageRasterizer().rasterize(new TextEncoder().encode("not a pdf"), [{ page: 1 }]);

    expect(result).toEqual({ ok: false, error: { code: "PDF_CORRUPT" } });
  });

  it("refuses a rendering that would be too large", async () => {
    const result = await createPdfjsPageRasterizer().rasterize(buildPdf(), [{ dpi: 600, page: 1 }]);

    expect(result.ok).toBe(true);
    const large = await createPdfjsPageRasterizer({
      loadPdfjs: async () => ({
        getDocument: () => ({
          promise: Promise.resolve({
            canvasFactory: { create: () => ({ canvas: { toBuffer: () => new Uint8Array() }, context: {} }) },
            getPage: async () => ({
              cleanup: () => undefined,
              getViewport: () => ({ height: 20000, width: 20000 }),
              render: () => ({ promise: Promise.resolve() }),
            }),
            numPages: 1,
          }),
        }),
      }),
    }).rasterize(buildPdf(), [{ page: 1 }]);
    expect(large).toEqual({ ok: false, error: { code: "IMAGE_TOO_LARGE" } });
  });
});