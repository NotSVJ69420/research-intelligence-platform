/**
 * Paper Service Integration Test
 *
 * Prerequisites:
 *   - PostgreSQL running with a 'research_engine' database
 *   - npm install pg xml2js
 *
 * Run: node test/test-paper-service.js
 */

import { initializeDatabase } from '../services/schema.js';
import {
  searchAndStore,
  getAllPapers,
  getPaperById,
  deletePaper,
} from '../services/paper-service.js';

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(label, condition) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${label}`);
      failed++;
    }
  }

  // ──── Setup ────
  console.log('\n═══ Setup: Initialize Database ═══');
  try {
    await initializeDatabase();
    console.log('  ✓ Database initialized');
    passed++;
  } catch (err) {
    console.error('  ✗ FAIL: Could not initialize database:', err.message);
    console.error('\n⚠ Make sure PostgreSQL is running and research_engine database exists.\n');
    process.exit(1);
  }

  // ──── Test 1: searchAndStore ────
  console.log('\n═══ Test 1: searchAndStore("compiler design", ["openalex"], 5) ═══');
  let papers = [];
  try {
    papers = await searchAndStore('compiler design', ['openalex'], 5);
    assert('Returns array', Array.isArray(papers));
    assert(`Returns ≤ 5 papers (got ${papers.length})`, papers.length <= 5 && papers.length > 0);

    // Check IDs are actual UUIDs from DB
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const allUuids = papers.every(p => uuidRegex.test(p.id));
    assert('All papers have valid UUID IDs', allUuids);
  } catch (err) {
    console.error('  ✗ FAIL: threw error:', err.message);
    failed++;
  }

  // ──── Test 2: ID consistency (re-run same search) ────
  console.log('\n═══ Test 2: ID consistency (same search again) ═══');
  try {
    const papers2 = await searchAndStore('compiler design', ['openalex'], 5);

    // IDs should match first run (DB dedup returns same rows)
    if (papers.length > 0 && papers2.length > 0) {
      const firstId1 = papers[0].id;
      const match = papers2.find(p => p.source_id === papers[0].source_id);
      assert('Same paper gets same DB ID across runs', match && match.id === firstId1);
    } else {
      assert('Papers returned for comparison', false);
    }
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    failed++;
  }

  // ──── Test 3: getAllPapers ────
  console.log('\n═══ Test 3: getAllPapers() ═══');
  try {
    const all = await getAllPapers();
    assert('Returns array', Array.isArray(all));
    assert(`Returns ≤ 50 papers (got ${all.length})`, all.length <= 50);
    assert('Papers have created_at field', all.length === 0 || all[0].created_at !== undefined);
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    failed++;
  }

  // ──── Test 4: getPaperById ────
  console.log('\n═══ Test 4: getPaperById ═══');
  try {
    if (papers.length > 0) {
      const found = await getPaperById(papers[0].id);
      assert('Found paper by ID', found !== null);
      assert('Title matches', found && found.title === papers[0].title);
    }

    const notFound = await getPaperById('00000000-0000-0000-0000-000000000000');
    assert('Returns null for non-existent ID', notFound === null);
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    failed++;
  }

  // ──── Test 5: deletePaper ────
  console.log('\n═══ Test 5: deletePaper ═══');
  try {
    if (papers.length > 0) {
      const deleted = await deletePaper(papers[0].id);
      assert('Delete returns true', deleted === true);

      const deletedAgain = await deletePaper(papers[0].id);
      assert('Second delete returns false', deletedAgain === false);

      const gone = await getPaperById(papers[0].id);
      assert('Paper is gone after delete', gone === null);
    }
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    failed++;
  }

  // ──── Summary ────
  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
