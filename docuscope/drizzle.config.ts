import type { Config } from 'drizzle-kit';

import { configDotenv } from 'dotenv';

configDotenv({ path: ".env.local" });

export default {
  schema: './lib/drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
