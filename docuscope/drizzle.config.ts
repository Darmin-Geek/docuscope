import type { Config } from 'drizzle-kit';

import { configDotenv } from 'dotenv';

configDotenv({ path: ".env.local" });

export default {
  schema: './lib/drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER!,
    database: process.env.DB_NAME!,
    password: process.env.DB_PASSWORD,
    ssl: process.env.TEST_AUTH_SECRET ? false : { rejectUnauthorized: false },
  },
} satisfies Config;
