/**
 * Database Connection Module
 *
 * Singleton pg.Pool instance.
 * Config from env vars with sensible defaults.
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME     || 'research_engine',
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err);
});

/**
 * Run a parameterized query.
 * @param {string} text - SQL query string.
 * @param {any[]} params - Query parameters.
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params) {
  return pool.query(text, params);
}
