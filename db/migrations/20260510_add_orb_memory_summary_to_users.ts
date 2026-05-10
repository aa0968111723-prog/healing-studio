import { sql } from "drizzle-orm";

export const up = sql`
SET @db := DATABASE();
SET @stmt := IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'users' AND column_name = 'orb_memory_summary'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN orb_memory_summary text NULL AFTER lastSignedIn'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
`;
