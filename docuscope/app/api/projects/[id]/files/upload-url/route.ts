import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email, uid } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);

    const body = await request.json() as { filename: string; contentType: string };
    const key = `projects/${id}/files/${crypto.randomUUID()}/${body.filename}`;

    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        ContentType: body.contentType,
      }),
      { expiresIn: 60 },
    );

    return NextResponse.json({ url, key });
  } catch (err) {
    return apiError(err);
  }
}
