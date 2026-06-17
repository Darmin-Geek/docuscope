// Server-only — import only from API routes, never from client components.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// Disable the web worker. pdfjs-dist falls back to running inline in the
// calling thread when workerSrc is empty, which is correct in Node.js where
// there is no Worker API.
GlobalWorkerOptions.workerSrc = '';

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({ data });
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
