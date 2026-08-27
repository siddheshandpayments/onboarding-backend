/**
 * Minimal SQL migration runner. No ORM, no schema DSL — migrations are
 * just numbered .sql files in /migrations, applied in filename order,
 * each wrapped in a transaction. Applied filenames are tracked in
 * schema_migrations so re-running this script is a no-op for files
 * already applied.
 *
 * Usage: npm run migrate
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import 'dotenv/config';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows: appliedRows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filenames are zero-padded (0001_, 0002_, ...) so lexical sort = execution order

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    await pool.end();
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
      console.log(`Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed on ${file}, rolled back.`);
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log(`Done. Applied ${pending.length} migration(s).`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
