// Client-side PDF text extraction.
//
// pdfjs-dist is loaded with a dynamic import so it never ends up in the server
// bundle and only runs in the browser. The worker is resolved through the
// bundler via `new URL(..., import.meta.url)`, the approach pdf.js documents for
// webpack 5 / Turbopack.

/** True for files we should attempt text extraction on. */
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Extracts the concatenated text content of a PDF file in the browser.
 * Returns the empty string for a PDF with no extractable text.
 */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(text);
    }
    return pages.join('\n').replace(/\s+/g, ' ').trim();
  } finally {
    await loadingTask.destroy();
  }
}
