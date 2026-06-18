// Server-only — import only from API routes, never from client components.
import { spawn } from 'child_process';

// Shells out to pdftotext (poppler-utils), which is already installed in the
// container as a transitive dependency of ocrmypdf. This avoids importing
// pdfjs-dist on the server, which fails because the worker script cannot be
// resolved in the Next.js server bundle.
export function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // '-' means read from stdin / write to stdout.
    const proc = spawn('pdftotext', ['-', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('close', (code) => {
      if (code !== 0)
        reject(new Error(`pdftotext exited ${code}: ${Buffer.concat(err).toString()}`));
      else resolve(Buffer.concat(out).toString('utf8').replace(/\s+/g, ' ').trim());
    });
    proc.on('error', reject);
    proc.stdin.end(buffer);
  });
}
