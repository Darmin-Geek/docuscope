import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { getProjectsForUser, createProject } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  try {
    const { email } = await verifyAuth(request);
    const data = await getProjectsForUser(email);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await verifyAuth(request);
    const body = await request.json() as { title: string; contributorEmails?: string[] };
    const id = await createProject(body.title, email, body.contributorEmails ?? []);
    return NextResponse.json({ id });
  } catch (err) {
    return apiError(err);
  }
}
