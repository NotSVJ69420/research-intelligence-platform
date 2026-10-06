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

  // ──── Test 1: Single provider (arxiv, limit 3) ────
  console.log('\n═══ Test 1: Single provider (arxiv, limit 3) ═══');
  try {
    const papers = await searchPapers('quantum computing', ['arxiv'], 3);
    console.log(`  Returned ${papers.length} papers`);

    if (papers.length > 3) {
      console.error('  ✗ FAIL: more than 3 results for single provider');
      failed++;
    } else {
      console.log('  ✓ Count ≤ 3');
      passed++;
    }
  } catch (err) {
    console.error('  ✗ FAIL: threw an error:', err.message);
    failed++;
  }

  // ──── Test 2: Multiple providers (openalex + arxiv, limit 3) ────
  console.log('\n═══ Test 2: Multiple providers (openalex + arxiv, limit 3) ═══');
  try {
    const papers = await searchPapers('deep learning', ['openalex', 'arxiv'], 3);
    console.log(`  Returned ${papers.length} papers`);

    // Count ≤ limit * 2 (3 * 2 = 6)
    if (papers.length > 6) {
      console.error('  ✗ FAIL: more than 6 results (3 per provider)');
      failed++;
    } else {
      console.log('  ✓ Count ≤ 6 (up to 3 per provider)');
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
  } catch (err) {
    console.error('  ✗ FAIL: threw an error:', err.message);
    failed++;
  }

  // ──── Test 3: Partial failure ────
  console.log('\n═══ Test 3: Partial failure (arxiv + nonexistent, limit 3) ═══');
  try {
    const papers = await searchPapers('compiler design', ['arxiv', 'nonexistent'], 3);
    if (Array.isArray(papers) && papers.length <= 3) {
      console.log(`  ✓ Returned ${papers.length} papers (partial result ≤ 3)`);
      passed++;
    } else {
      console.error('  ✗ FAIL: unexpected result:', papers);
      failed++;
    }
  } catch (err) {
    console.error('  ✗ FAIL: threw an error:', err.message);
    failed++;
  }

  // ──── Test 4: Cross-provider duplicate handling ────
  console.log('\n═══ Test 4: Cross-provider duplicate handling (deduplicate unit check) ═══');
  try {
    const { deduplicate } = await import('../ingestion/dedupe.js');
    const mockPapers = [
      { id: '1', source: 'openalex', source_id: 'W1', title: 'Attention Is All You Need', doi: '10.1234/test', year: 2017, authors: ['Vaswani'] },
      { id: '2', source: 'arxiv', source_id: '1706.03762', title: 'Attention Is All You Need', doi: 'https://doi.org/10.1234/test', year: 2017, authors: ['Vaswani'] },
    ];
    const deduped = deduplicate(mockPapers);
    if (deduped.length === 1 && deduped[0].source === 'openalex') {
      console.log('  ✓ Duplicate collapsed properly across providers');
      passed++;
    } else {
      console.error('  ✗ FAIL: duplicate not collapsed:', deduped);
      failed++;
    }
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    failed++;
  }

  // ──── Test 5: Total failure / No valid providers ────
  console.log('\n═══ Test 5: Total failure (no valid providers) ═══');
  try {
    const papers = await searchPapers('test', ['nonexistent'], 10);
    if (Array.isArray(papers) && papers.length === 0) {
      console.log('  ✓ Returned empty array for nonexistent provider');
      passed++;
    } else {
      console.error('  ✗ FAIL: expected empty array, got:', papers);
      failed++;
    }

    const emptyPapers = await searchPapers('test', [], 10);
    if (Array.isArray(emptyPapers) && emptyPapers.length === 0) {
      console.log('  ✓ Returned empty array for empty provider list');
      passed++;
    } else {
      console.error('  ✗ FAIL: expected empty array, got:', emptyPapers);
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
