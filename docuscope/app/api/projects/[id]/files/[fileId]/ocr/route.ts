import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { verifyAuth } from '@/lib/verifyAuth';
import {
  requireContributor,
  getFile,
  replaceFileChunks,
  hasFileChunks,
  createOcrJob,
  getLatestOcrJob,
  markOcrJobRunning,
  completeOcrJob,
} from '@/lib/projects.server';
import { extractPdfTextFromBuffer } from '@/lib/pdfTextServer';
import { apiError } from '@/lib/apiError';

// OCR shells out to ocrmypdf and can run for minutes, so this route runs on the
// Node.js runtime (required for child_process) and never blocks the request on
// the work: POST enqueues a job and returns 202, the pipeline runs detached in
// this process, and the client polls GET for status.
export const runtime = 'nodejs';

// Hard ceiling on the ocrmypdf subprocess so a hung or pathological PDF can't
// pin the process forever. Must stay below the stale-job window in
// projects.server.ts (OCR_STALE_MS) so a job still within its budget is never
// reaped as dead.
const OCR_PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

function runProcess(
  cmd: string,
  args: string[],
  input: Buffer,
  timeoutMs = OCR_PROCESS_TIMEOUT_MS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString()}`));
      else resolve(Buffer.concat(out));
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.stdin.end(input);
  });
}

// The actual OCR pipeline. Runs detached (not awaited by the request) and is
// responsible for marking the job done/error so the polling client converges.
async function runOcrPipeline(
  jobId: string,
  fileId: string,
  storageReference: string,
): Promise<void> {
  try {
    await markOcrJobRunning(jobId);

    // Download the PDF from S3.
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: storageReference,
      }),
    );
    const body = obj.Body as { transformToByteArray(): Promise<Uint8Array> };
    const inputBytes = Buffer.from(await body.transformToByteArray());

    // Run OCRmyPDF: stdin → stdout, no disk I/O.
    const ocrBytes = await runProcess('ocrmypdf', ['--skip-text', '-', '-'], inputBytes);

    // Extract text BEFORE overwriting S3 so a failure here leaves the original
    // object intact rather than replacing it with an un-indexed copy.
    const text = await extractPdfTextFromBuffer(ocrBytes);

    // Replace the PDF in S3 with the OCR'd version (same key), then re-index.
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: storageReference,
        Body: ocrBytes,
        ContentType: 'application/pdf',
      }),
    );
    await replaceFileChunks(fileId, text);

    await completeOcrJob(jobId, null);
  } catch (err) {
    console.error('OCR pipeline failed', err);
    await completeOcrJob(jobId, err instanceof Error ? err.message : 'OCR failed').catch(
      (e) => console.error('Failed to mark OCR job errored', e),
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    // Confirm the file belongs to this project before reporting on it, so a
    // contributor can't probe chunk state for files in other projects.
    await getFile(id, fileId);

    const [chunksExist, job] = await Promise.all([
      hasFileChunks(fileId),
      getLatestOcrJob(fileId),
    ]);
    return NextResponse.json({
      hasChunks: chunksExist,
      status: job?.status ?? null,
      error: job?.error ?? null,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);

    const file = await getFile(id, fileId);

    // Enqueue first (throws 'Conflict' if a job is already active), then run
    // the pipeline detached so the response returns immediately. The floating
    // promise is intentional — `next start` keeps the process alive, so the
    // work continues after the response is sent; the pipeline owns its own
    // error handling and job-status updates.
    const job = await createOcrJob(fileId);
    void runOcrPipeline(job.id, fileId, file.storageReference);

    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (err) {
    return apiError(err);
  }
}
