import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { verifyAuth } from '@/lib/verifyAuth';
import {
  requireContributor,
  getFile,
  replaceFileChunks,
  hasFileChunks,
} from '@/lib/projects.server';
import { extractPdfTextFromBuffer } from '@/lib/pdfTextServer';
import { apiError } from '@/lib/apiError';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

function runProcess(cmd: string, args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('close', (code) => {
      if (code !== 0)
        reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString()}`));
      else resolve(Buffer.concat(out));
    });
    proc.on('error', reject);
    proc.stdin.end(input);
  });
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
    const chunksExist = await hasFileChunks(fileId);
    return NextResponse.json({ hasChunks: chunksExist });
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

    // Download the PDF from S3.
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: file.storageReference,
      }),
    );
    const body = obj.Body as {
      transformToByteArray(): Promise<Uint8Array>;
    };
    const inputBytes = Buffer.from(await body.transformToByteArray());

    // Run OCRmyPDF: stdin → stdout, no disk I/O.
    const ocrBytes = await runProcess('ocrmypdf', ['--skip-text', '-', '-'], inputBytes);

    // Replace the PDF in S3 with the OCR'd version (same key).
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: file.storageReference,
        Body: ocrBytes,
        ContentType: 'application/pdf',
      }),
    );

    // Extract text from the OCR'd PDF and store it as searchable chunks.
    const text = await extractPdfTextFromBuffer(ocrBytes);
    await replaceFileChunks(fileId, text);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
