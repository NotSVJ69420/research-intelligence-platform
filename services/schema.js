/**
 * Database Schema Module
 *
 * Creates tables and indexes on startup.
 * Idempotent — safe to call multiple times.
 */

import { query } from './db.js';

/**
 * Initialize the database: create tables and indexes if they don't exist.
 */
export async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS papers (
      id             UUID PRIMARY KEY,
      source         VARCHAR(50) NOT NULL,
      source_id      VARCHAR(255) NOT NULL,
      title          TEXT NOT NULL,
      abstract       TEXT,
      authors        JSONB DEFAULT '[]',
      year           INTEGER,
      venue          TEXT,
      doi            VARCHAR(255),
      url            TEXT,
      pdf_url        TEXT,
      citation_count INTEGER,
      created_at     TIMESTAMP DEFAULT NOW(),

      UNIQUE(source, source_id)
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_doi
      ON papers(doi) WHERE doi IS NOT NULL;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_papers_created_at
      ON papers(created_at DESC);
  `);

  console.log('[schema] Database initialized');
}
