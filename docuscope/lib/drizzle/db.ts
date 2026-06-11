import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Signer } from '@aws-sdk/rds-signer';
import * as schema from './schema';

function createDbConnection(): Pool {
  const host = process.env.DB_HOST!;
  const port = Number(process.env.DB_PORT ?? 5432);
  const user = process.env.DB_USER!;
  const database = process.env.DB_NAME!;

  // Test mode: plain connection to local Docker postgres
  if (process.env.TEST_AUTH_SECRET) {
    return new Pool({ host, port, user, database, password: process.env.DB_PASSWORD });
  }

  // Production: IAM auth token as the password, SSL required
  const signer = new Signer({
    hostname: host,
    port,
    username: user,
    region: process.env.AWS_REGION ?? 'us-east-2',
  });

  return new Pool({
    host,
    port,
    database,
    user,
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: false },
  });
}

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function instance() {
  if (!_db) _db = drizzle(createDbConnection(), { schema });
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get: (_, key) => Reflect.get(instance(), key),
});
