import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import {
  requireContributor,
  getFiles,
  createFileRecord,
  getFolderFileIds,
  resolveEditorName,
} from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const folderId = request.nextUrl.searchParams.get('folderId');
    const search = request.nextUrl.searchParams.get('q') ?? '';
    const data = await getFiles(id, folderId ?? null, search);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const body = await request.json() as {
      filename: string;
      storageReference: string;
      author: string | null;
      folderId: string | null;
      text?: string | null;
    };
    const editorName = await resolveEditorName(uid, email);
    const file = await createFileRecord(
      id,
      body.filename,
      body.storageReference,
      body.author ?? null,
      body.folderId ?? null,
      body.text ?? null,
      { uid, name: editorName },
    );
    return NextResponse.json(file);
  } catch (err) {
    return apiError(err);
  }
}
