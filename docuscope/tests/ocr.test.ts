import { test, expect } from '@playwright/test';
import {
  getFiles,
  replaceFileChunks,
  hasFileChunks,
  createOcrJob,
  getLatestOcrJob,
  markOcrJobRunning,
  completeOcrJob,
} from '../lib/projects.server';
import { createTestProject, createTestFile, insertChunks } from './db-helpers';
import { db } from '../lib/drizzle/db';
import { ocrJobs } from '../lib/drizzle/schema';
import { eq } from 'drizzle-orm';

test.describe('replaceFileChunks', () => {
  test('stores chunks so the file is searchable', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    await replaceFileChunks(fileId, 'quantum mechanics wave function');

    const results = await getFiles(projectId, null, 'quantum');
    expect(results.map((f) => f.id)).toContain(fileId);
  });

  test('replaces existing chunks', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await insertChunks(fileId, ['old content about biology']);

    await replaceFileChunks(fileId, 'new content about astronomy');

    const biology = await getFiles(projectId, null, 'biology');
    expect(biology.map((f) => f.id)).not.toContain(fileId);

    const astronomy = await getFiles(projectId, null, 'astronomy');
    expect(astronomy.map((f) => f.id)).toContain(fileId);
  });

  test('deletes all chunks when text is empty', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await insertChunks(fileId, ['some existing text']);

    await replaceFileChunks(fileId, '');

    const has = await hasFileChunks(fileId);
    expect(has).toBe(false);
  });
});

test.describe('hasFileChunks', () => {
  test('returns false for a file with no chunks', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    expect(await hasFileChunks(fileId)).toBe(false);
  });

  test('returns true after chunks are inserted', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await insertChunks(fileId, ['some text']);
    expect(await hasFileChunks(fileId)).toBe(true);
  });
});

test.describe('OCR jobs', () => {
  test('createOcrJob enqueues a pending job', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    const job = await createOcrJob(fileId);
    expect(job.status).toBe('pending');

    const latest = await getLatestOcrJob(fileId);
    expect(latest?.id).toBe(job.id);
    expect(latest?.status).toBe('pending');
  });

  test('rejects a second active job for the same file', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    await createOcrJob(fileId);
    await expect(createOcrJob(fileId)).rejects.toThrow('Conflict');
  });

  test('completing a job frees the file for a new one', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    const first = await createOcrJob(fileId);
    await markOcrJobRunning(first.id);
    await completeOcrJob(first.id, null);

    const latest = await getLatestOcrJob(fileId);
    expect(latest?.status).toBe('done');

    // A finished job is no longer "active", so a fresh run is allowed.
    const second = await createOcrJob(fileId);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
  });

  test('completeOcrJob with a message marks the job errored', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    const job = await createOcrJob(fileId);
    await completeOcrJob(job.id, 'ocrmypdf exited 1');

    const latest = await getLatestOcrJob(fileId);
    expect(latest?.status).toBe('error');
    expect(latest?.error).toBe('ocrmypdf exited 1');
  });

  test('reaps a stale running job and allows a new one', async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    const job = await createOcrJob(fileId);
    await markOcrJobRunning(job.id);
    // Backdate the job well past the 15-minute stale window to simulate a
    // worker that died mid-run.
    await db
      .update(ocrJobs)
      .set({ updatedAt: Date.now() - 60 * 60 * 1000 })
      .where(eq(ocrJobs.id, job.id));

    // Reading self-heals the stale job to 'error'.
    const latest = await getLatestOcrJob(fileId);
    expect(latest?.status).toBe('error');

    // …and the file is no longer blocked by the dead job.
    const fresh = await createOcrJob(fileId);
    expect(fresh.status).toBe('pending');
  });
});
