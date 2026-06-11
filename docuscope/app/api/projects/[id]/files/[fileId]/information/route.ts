import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getInformation, addInformation } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const data = await getInformation(id, fileId);
    return NextResponse.json(data);
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
    const body = await request.json() as {
      id?: string;
      informationTitle: string;
      informationText: string | null;
      overallBias: string | null;
      informationReliability: string | null;
      informationCredibility: string | null;
    };
    const { id: infoId, ...fields } = body;
    const newId = await addInformation(id, fileId, fields, infoId);
    return NextResponse.json({ id: newId });
  } catch (err) {
    return apiError(err);
  }
}
