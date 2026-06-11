import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Signer } from '@aws-sdk/rds-signer';
import * as schema from './schema';

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL!;

  // Test mode: plain connection to local Docker postgres
  if (process.env.TEST_AUTH_SECRET) {
    return new Pool({ connectionString });
  }

  // Production: IAM auth token as the password, SSL required
  const url = new URL(connectionString);
  const host = url.hostname;
  const port = parseInt(url.port || '5432', 10);
  const user = url.username;
  const database = url.pathname.slice(1);

  const signer = new Signer({
    hostname: host,
    port,
    username: user,
    region: process.env.AWS_REGION ?? 'us-east-2',
  });

  return new Pool({
    host,
    port,
    user,
    database,
    ssl: { rejectUnauthorized: true },
    password: () => signer.getAuthToken(),
  });
}

const pool = createPool();
export const db = drizzle(pool, { schema });
