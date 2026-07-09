import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile } from '@/lib/projects.server';
import { updateDatetime, deleteDatetime } from '@/lib/timelines.server';
import type { DatetimeInputPayload } from '@/lib/timelines';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      fileId: string;
      infoId: string;
      datetimeId: string;
    }>;
  },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId, infoId, datetimeId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    const payload = (await request.json()) as DatetimeInputPayload;
    const datetime = await updateDatetime(id, fileId, infoId, datetimeId, payload);
    return NextResponse.json(datetime);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      fileId: string;
      infoId: string;
      datetimeId: string;
    }>;
  },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId, infoId, datetimeId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    await deleteDatetime(id, fileId, infoId, datetimeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
