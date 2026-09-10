import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './password.js';
export const pool = new pg.Pool({ max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
pool.on('error', error => console.error('Database connection failed:', error.code || 'unknown'));
export async function transaction(action) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function initializeDatabase() {
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(8091031)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
    if (!(await client.query('SELECT id FROM users LIMIT 1')).rowCount) {
      const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
      const password = process.env.ADMIN_PASSWORD || '';
      if (!/^[a-z0-9_.@-]{3,64}$/.test(username) || password.length < 12 || password.length > 128) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (12–128 characters) before startup.');
      const id = randomUUID();
      await client.query("INSERT INTO users(id,username,name,password_hash,role) VALUES ($1,$2,'系統管理員',$3,'ADMIN')", [id, username, await hashPassword(password)]);
      await client.query("INSERT INTO audit_events(id,user_id,actor,action) VALUES ($1,$2,'system','CREATE_USER')", [randomUUID(), id]);
      console.log('Initial administrator created.');
    }
  });
}
