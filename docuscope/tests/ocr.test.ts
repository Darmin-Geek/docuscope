import { test, expect } from '@playwright/test';
import { getFiles, replaceFileChunks, hasFileChunks } from '../lib/projects.server';
import { createTestProject, createTestFile, insertChunks } from './db-helpers';

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
