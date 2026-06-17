// Server-only — import only from API routes, never from client components.
import { PDFParse } from 'pdf-parse';

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ pageJoiner: '\n' });
    return result.text.replace(/\s+/g, ' ').trim();
  } finally {
    await parser.destroy();
  }
}
