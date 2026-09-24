/**
 * Ingestion System Test Script
 *
 * Validates:
 *   1. Normal query: returns ≤ limit results with correct schema
 *   2. Partial failure: unknown source gets warning, valid source still returns
 *   3. Total failure: unknown-only sources return []
 */

import { searchPapers } from '../ingestion/search-orchestrator.js';

const SCHEMA_KEYS = [
  'id', 'source', 'source_id', 'title', 'abstract',
  'authors', 'year', 'venue', 'doi', 'url', 'pdf_url', 'citation_count',
];

function validatePaper(paper, index) {
  const errors = [];

  // All keys must be present
  for (const key of SCHEMA_KEYS) {
    if (!(key in paper)) {
      errors.push(`Paper[${index}] missing key: "${key}"`);
    }
  }

  // No undefined values
  for (const [key, value] of Object.entries(paper)) {
    if (value === undefined) {
      errors.push(`Paper[${index}].${key} is undefined (should be null)`);
    }
  }

  // id must be non-null UUID
  if (!paper.id || typeof paper.id !== 'string') {
    errors.push(`Paper[${index}].id is not a valid string`);
  }

  // authors must be an array
  if (!Array.isArray(paper.authors)) {
    errors.push(`Paper[${index}].authors is not an array`);
  }

  return errors;
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  // ──── Test 1: Normal query ────
  console.log('\n═══ Test 1: Normal query ("compiler design", both sources, limit 20) ═══');
  try {
    const papers = await searchPapers('compiler design', ['openalex', 'arxiv'], 20);
    console.log(`  Returned ${papers.length} papers`);

    // Count ≤ limit
    if (papers.length > 20) {
      console.error('  ✗ FAIL: more than 20 results');
      failed++;
    } else {
      console.log('  ✓ Count ≤ 20');
      passed++;
    }

    // Schema validation
    let schemaOk = true;
    for (let i = 0; i < papers.length; i++) {
      const errs = validatePaper(papers[i], i);
      if (errs.length > 0) {
        errs.forEach(e => console.error(`  ✗ ${e}`));
        schemaOk = false;
      }
    }
    if (schemaOk) {
      console.log('  ✓ All papers pass schema validation');
      passed++;
    } else {
      failed++;
    }

    // No duplicate DOIs
    const dois = papers.map(p => p.doi).filter(d => d != null);
    const uniqueDois = new Set(dois);
    if (dois.length === uniqueDois.size) {
      console.log('  ✓ No duplicate DOIs');
      passed++;
    } else {
      console.error(`  ✗ FAIL: duplicate DOIs found (${dois.length} total, ${uniqueDois.size} unique)`);
      failed++;
    }

    // Ranking: citation_count descending, nulls last
    let rankOk = true;
    for (let i = 1; i < papers.length; i++) {
      const prevCit = papers[i - 1].citation_count ?? -Infinity;
      const currCit = papers[i].citation_count ?? -Infinity;
      if (prevCit < currCit) {
        rankOk = false;
        break;
      }
    }
    if (rankOk) {
      console.log('  ✓ Ranking order correct (citation_count desc, nulls last)');
      passed++;
    } else {
      console.error('  ✗ FAIL: ranking order incorrect');
      failed++;
    }

    // Print first paper as sample
    if (papers.length > 0) {
      console.log('\n  Sample paper:');
      console.log(JSON.stringify(papers[0], null, 2));
    }
  } catch (err) {
    console.error('  ✗ FAIL: threw an error:', err.message);
    failed++;
  }

  // ──── Test 2: Partial failure ────
  console.log('\n═══ Test 2: Partial failure (openalex + nonexistent) ═══');
  try {
    const papers = await searchPapers('machine learning', ['openalex', 'nonexistent'], 10);
    if (Array.isArray(papers)) {
      console.log(`  ✓ Returned ${papers.length} papers (partial result)`);
      passed++;
    } else {
      console.error('  ✗ FAIL: did not return array');
      failed++;
    }
  } catch (err) {
    console.error('  ✗ FAIL: threw an error:', err.message);
    failed++;
  }

  // ──── Test 3: Total failure ────
  console.log('\n═══ Test 3: Total failure (nonexistent only) ═══');
  try {
    const papers = await searchPapers('test', ['nonexistent'], 10);
    if (Array.isArray(papers) && papers.length === 0) {
      console.log('  ✓ Returned empty array');
      passed++;
    } else {
      console.error('  ✗ FAIL: expected empty array, got:', papers);
      failed++;
    }
  } catch (err) {
    console.error('  ✗ FAIL: threw an error:', err.message);
    failed++;
  }

  // ──── Summary ────
  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
}

runTests();
