import { NextResponse } from 'next/server';

export function apiError(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (err.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (err.message === 'Not found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (err.message === 'Conflict') return NextResponse.json({ error: 'Conflict' }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
