import { execSync } from 'node:child_process';
import { Pool } from 'pg';

// Runs once before all tests. Verifies the database is reachable so failures
// give a clear error instead of a cryptic network timeout, then pushes the
// current Drizzle schema so a freshly (re)created container is never missing
// tables that were added since the volume was last provisioned.
export default async function globalSetup() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://docuscope:docuscope@localhost:5433/docuscope',
  });
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      await pool.end();
      execSync('npm run db:push -- --force', { stdio: 'inherit' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await pool.end().catch(() => {});
  throw new Error(
    'Database is not reachable.\n' +
      "Run tests via `npm test` which starts Docker automatically,\n" +
      'or start it manually with: docker-compose up -d',
  );
}
