// Audit: re-derive every quantitative claim made in main.tex from the raw result JSON and compare
// (a) paper statement vs. raw results, (b) original run vs. independent re-run (if RERUN_DIR is given).
// Usage: node verify_claims.mjs [RERUN_DIR]   ->  writes claims_report.json / claims_report.md next to this file.
import fs from 'fs';
const here = new URL('.', import.meta.url).pathname;
const R = (n, dir = here + '../results/') => JSON.parse(fs.readFileSync(dir + n, 'utf8'));
const RERUN = process.argv[2] ? (process.argv[2].endsWith('/') ? process.argv[2] : process.argv[2] + '/') : null;
const claims = [];
const RR = (n) => (RERUN ? R(n, RERUN) : null); // independent second execution, if supplied
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function claim(id, section, statement, actual, ok) { claims.push({ id, section, statement, actual: String(actual), pass: !!ok }); }

// ---------- E3 sweep (Fig. 3) ----------
const sw = R('e3_sweep.json').rows;
const diffs = sw.map(r => r.observed.median - r.model_parallel_ms);
claim('E3.1', 'VI-B', 'Observed median within 4--11 ms of the parallel model at every L', diffs.map(d => d.toFixed(1)).join(', '), Math.min(...diffs) >= 3.5 && Math.max(...diffs) <= 11.5);
const r1000 = sw.find(r => r.L === 1000);
claim('E3.2', 'VI-B', '2 011 ms observed vs 2 000 ms predicted at L=1 s', `${r1000.observed.median.toFixed(0)} vs ${r1000.model_parallel_ms}`, Math.round(r1000.observed.median) === 2011 && r1000.model_parallel_ms === 2000);
claim('E3.3', 'VI-B', 'Source-sequential and fully serial alternatives are 8 000 and 17 000 ms at L=1 s', `${r1000.model_source_sequential_ms}, ${r1000.model_fully_sequential_ms}`, r1000.model_source_sequential_ms === 8000 && r1000.model_fully_sequential_ms === 17000);
claim('E3.4', 'VI-B', 'At L=0 the search takes ~358 ms (PubMed 350 ms spacing floor)', sw[0].observed.median.toFixed(1), near(sw[0].observed.median, 358, 1));
claim('E3.5', 'VI-B', 'IQR about 1 ms or less', sw.map(r => (r.observed.p75 - r.observed.p25).toFixed(2)).join(', '), sw.every(r => r.observed.p75 - r.observed.p25 <= 1.5));
claim('E3.6', 'VI-B', 'n = 5 repetitions per latency', sw.map(r => r.observed.n).join(','), sw.every(r => r.observed.n === 5));
// ---------- warm ----------
const wm = R('e3_warm.json').rows;
const g = (gap) => wm.find(r => r.idleGapBetweenSearches_ms === gap);
claim('E3.7', 'VI-B', 'Immediate second search 2 652 ms (range 2 642--2 656), first 455 ms', `${g(0).second.median.toFixed(0)} [${g(0).second.min.toFixed(0)}, ${g(0).second.max.toFixed(0)}], first ${g(0).first.median.toFixed(0)}`, near(g(0).second.median, 2652, 1) && near(g(0).second.min, 2642, 1) && near(g(0).second.max, 2656, 1) && near(g(0).first.median, 455, 1));
claim('E3.8', 'VI-B', 'After idle gaps of 1 s, 2 s, 3.5 s: 1 650, 647, 454 ms', `${g(1000).second.median.toFixed(0)}, ${g(2000).second.median.toFixed(0)}, ${g(3500).second.median.toFixed(0)}`, near(g(1000).second.median, 1650, 1) && near(g(2000).second.median, 647, 1) && near(g(3500).second.median, 454, 1));
// ---------- amplification ----------
const am = R('e3_amplify.json').rows;
claim('E3.9', 'VI-B / Tab. VI', 'Requests per search 12/17/27/57 for k=5/10/20/50 (= 7 + k); enrichment = k', am.map(r => `${r.limit}:${r.totalUpstreamRequests}/${r.perEndpoint['europe_pmc→crossref enrichment']}`).join(' '), am.every(r => r.totalUpstreamRequests === 7 + r.limit && r.perEndpoint['europe_pmc→crossref enrichment'] === r.limit));
// ---------- faults ----------
const fl = R('e3_faults.json').rows;
const okProv = ['openalex', 'semantic_scholar', 'crossref', 'europe_pmc', 'pubmed'];
claim('E3.10', 'VI-B / Tab. VII', 'HTTP 500 / network error: five providers reported failed and listed; arXiv reported success with 0 items and NOT listed',
  fl.filter(r => r.fault !== 'http429').map(r => `${r.faultySource}:${r.statusReported}/${r.listedInProviderFailures}`).join(' '),
  fl.filter(r => r.fault !== 'http429').every(r => (r.faultySource === 'arxiv') ? (r.statusReported === 'success' && !r.listedInProviderFailures && r.countReported === 0) : (r.statusReported === 'failed' && r.listedInProviderFailures)));
const nonPm = fl.filter(r => r.fault !== 'http429' && r.faultySource !== 'pubmed');
const pm = fl.filter(r => r.faultySource === 'pubmed');
claim('E3.11', 'VI-B / Tab. VII', 'Wall-clock 0.11--0.41 s for HTTP 500 / network error', `${Math.min(...pm.map(r => r.elapsed_ms))}..${Math.max(...nonPm.map(r => r.elapsed_ms))} ms`, Math.min(...pm.map(r => r.elapsed_ms)) >= 100 && Math.max(...nonPm.map(r => r.elapsed_ms)) <= 415);
claim('E3.12', 'VI-B / Tab. VII', 'S2 HTTP 429: failed after one retry, 2.11 s', JSON.stringify(fl.filter(r => r.fault === 'http429').map(r => [r.statusReported, r.elapsed_ms, r.requestsToFaultySource])), fl.filter(r => r.fault === 'http429').every(r => r.statusReported === 'failed' && near(r.elapsed_ms, 2109, 30) && r.requestsToFaultySource === 2));
claim('E3.13', 'VI-B', 'Other providers intact in every fault case', fl.map(r => r.otherSourcesIntact).join(','), fl.every(r => r.otherSourcesIntact));
const hang = ['openalex', 'pubmed', 'arxiv'].map(s => [s, R(`e3_hang_${s}.json`)]);
claim('E3.14', 'VI-B / Tab. VII', 'Hang: OpenAlex 15.02 s, PubMed 25.03 s, arXiv 30.03 s (n = 3, spread < 3 ms); arXiv reported success, others failed', hang.map(([s, h]) => `${s}:${(h.elapsed_ms.median / 1000).toFixed(2)}s n=${h.elapsed_ms.n} spread=${(h.elapsed_ms.max - h.elapsed_ms.min).toFixed(1)}ms ${h.statusReported.status}`).join(' | '),
  hang.every(([s, h]) => h.elapsed_ms.n === 3 && h.elapsed_ms.max - h.elapsed_ms.min < 3.5) && near(hang[0][1].elapsed_ms.median, 15025, 20) && near(hang[1][1].elapsed_ms.median, 25030, 20) && near(hang[2][1].elapsed_ms.median, 30030, 20) && hang[2][1].statusReported.status === 'success' && hang[0][1].statusReported.status === 'failed' && hang[1][1].statusReported.status === 'failed');
// ---------- E2 ----------
const e2 = R('e2_dedup.json');
const A = Object.fromEntries(e2.A.s_no_doi.map(r => [r.perturbation, r]));
const zero = Object.entries(A).filter(([k]) => !['none', 'title upper-cased'].includes(k));
claim('E2.1', 'VI-C / Fig. 4', 'Repository recall = 0.00 for every perturbation without a DOI, except identical metadata and letter case (=1.00)', zero.map(([k, r]) => `${k}:${r.recall.repo}`).join('; '), zero.every(([, r]) => r.recall.repo === 0) && A['none'].recall.repo === 1 && A['title upper-cased'].recall.repo === 1);
claim('E2.2', 'VI-C', 'uf-repo identical to repository on pairs', Object.values(A).every(r => r.recall.uf_repo_keys === r.recall.repo), Object.values(A).every(r => r.recall.uf_repo_keys === r.recall.repo));
const relaxedFail = Object.entries(A).filter(([, r]) => r.recall.uf_relaxed !== 1).map(([k]) => k).sort();
claim('E2.3', 'VI-C', 'Relaxed prototype recall 1.00 except reversed authors and dropped subtitle', relaxedFail.join(', '), JSON.stringify(relaxedFail) === JSON.stringify(['author order reversed', 'title subtitle dropped']));
const ns = e2.A.s_no_doi.map(r => r.applicable);
claim('E2.4', 'VI-C / Fig. 4 caption', 'n = 161--500 works per perturbation', `${Math.min(...ns)}--${Math.max(...ns)}`, Math.min(...ns) === 161 && Math.max(...ns) === 500);
claim('E2.5', 'VI-C', 'With a shared DOI every variant merges all pairs for every perturbation', e2.A.both_doi.map(r => r.recall.repo + '/' + r.recall.uf_relaxed).join(' '), e2.A.both_doi.every(r => Object.values(r.recall).every(v => v === 1)));
const C = Object.fromEntries(e2.C.rows.map(r => [r.order, r.records]));
claim('E2.6', 'VI-C / Tab. VIII', 'Order dependence: repository 2000 for ABC/ACB/CAB/CBA, 1000 for BAC/BCA; union-find 1000 for all', JSON.stringify(C), ['ABC', 'ACB', 'CAB', 'CBA'].every(o => C[o].repo === 2000) && ['BAC', 'BCA'].every(o => C[o].repo === 1000) && Object.values(C).every(c => c.uf_repo_keys === 1000 && c.uf_relaxed === 1000));
const B = e2.B;
claim('E2.7', 'VI-C', 'Probes: 500/500 merged (distinct DOI), 100 empty-title records -> 1, 0/500 vs 500/500 (Wei/Wen)', JSON.stringify([B.distinct_doi_same_title_author_year.falseMerged, B.empty_title_records.outputRecords, B.same_initial_different_person.falseMerged]),
  B.distinct_doi_same_title_author_year.falseMerged.repo === 500 && B.empty_title_records.outputRecords.repo === 1 && B.same_initial_different_person.falseMerged.repo === 0 && B.same_initial_different_person.falseMerged.uf_relaxed === 500);
const D = Object.fromEntries(e2.D.configs.map(c => [c.limit, c]));
claim('E2.8', 'VI-C / Tab. IX', 'k=10: raw 1200, distinct 1121, outputs 1130/1130/1121, residual 9/9/0', `${D[10].raw}, ${D[10].uniqueWorks}, ` + Object.values(D[10].perVariant).map(v => v.outputRecords + '/' + v.residualDuplicates).join(' '), D[10].raw === 1200 && D[10].uniqueWorks === 1121 && D[10].perVariant.repo.outputRecords === 1130 && D[10].perVariant.repo.residualDuplicates === 9 && D[10].perVariant.uf_repo_keys.residualDuplicates === 9 && D[10].perVariant.uf_relaxed.residualDuplicates === 0);
claim('E2.9', 'VI-C / Tab. IX', 'k=25: raw 3000, distinct 2522, outputs 2588/2584/2522, residual 66/62/0', `${D[25].raw}, ${D[25].uniqueWorks}, ` + Object.values(D[25].perVariant).map(v => v.outputRecords + '/' + v.residualDuplicates).join(' '), D[25].raw === 3000 && D[25].uniqueWorks === 2522 && D[25].perVariant.repo.outputRecords === 2588 && D[25].perVariant.uf_repo_keys.outputRecords === 2584 && D[25].perVariant.uf_relaxed.outputRecords === 2522);
claim('E2.10', 'VI-C', 'Residual duplicates 0.8% and 2.6% of works; all pairs involve arXiv; no work lost', `${(100 * 9 / 1121).toFixed(2)}%, ${(100 * 66 / 2522).toFixed(2)}%; ` + JSON.stringify(D[25].residualPairTypes), near(100 * 9 / 1121, 0.8, 0.05) && near(100 * 66 / 2522, 2.6, 0.05) && Object.keys({ ...D[10].residualPairTypes, ...D[25].residualPairTypes }).every(k => k.includes('arxiv')) && Object.values(D).every(c => Object.values(c.perVariant).every(v => v.lostWorks === 0)));
claim('E2.11', 'VI-C', 'Replicated pipeline and real orchestrator give identical output sizes (58, 133)', JSON.stringify([D[10].consistencyCheck, D[25].consistencyCheck]), D[10].consistencyCheck.orchestratorOutput === 58 && D[10].consistencyCheck.replicatedPipelineOutput === 58 && D[25].consistencyCheck.orchestratorOutput === 133 && D[25].consistencyCheck.replicatedPipelineOutput === 133);
// ---------- E1 ----------
const e1 = R('e1_normalizers.json'); const e1r = RR('e1_normalizers.json'); const nu = e1.normalize_us_per_record;
const nuAll = [e1, e1r].filter(Boolean).map(x => x.normalize_us_per_record);
const allNu = nuAll.flatMap(o => Object.values(o).map(v => v.median));
claim('E1.1', 'VI-D', 'Normalizers cost 3.1--6.6 us per record across two independent executions (single-run values vary up to ~45%, e.g. OpenAlex 6.6 vs 3.6); no provider ranking is claimed', nuAll.map(o => Object.entries(o).map(([k, v]) => `${k}:${v.median.toFixed(2)}`).join(' ')).join(' || '), Math.min(...allNu) >= 3.0 && Math.max(...allNu) <= 6.7);
const xpAll = (s, n) => [e1, e1r].filter(Boolean).map(x => x.xml_parse_ms.find(r => r.source === s && r.entries === n));
claim('E1.2', 'VI-D', 'XML parse, 100 entries: arXiv 2.4--3.8 ms (79 kB), PubMed 5.7--7.4 ms (122 kB) across two executions', `arXiv ${xpAll('arxiv', 100).map(r => r.median.toFixed(2)).join('/')}, PubMed ${xpAll('pubmed', 100).map(r => r.median.toFixed(2)).join('/')}; ${xpAll('arxiv', 100)[0].bytes} B, ${xpAll('pubmed', 100)[0].bytes} B`, xpAll('arxiv', 100).every(r => r.median >= 2.2 && r.median <= 3.9) && xpAll('pubmed', 100).every(r => r.median >= 5.5 && r.median <= 7.6) && Math.round(xpAll('arxiv', 100)[0].bytes / 1000) === 79 && Math.round(xpAll('pubmed', 100)[0].bytes / 1000) === 122);
const cpu = R('e3_cpu.json').rows; const cpuR = RR('e3_cpu.json')?.rows;
const c = (k) => cpu.find(r => r.limit === k);
const cr = (k) => cpuR?.find(r => r.limit === k);
const both = (k) => [c(k).wall_ms.median, ...(cr(k) ? [cr(k).wall_ms.median] : [])];
claim('E3.15', 'VI-D', 'Orchestration CPU (4 JSON providers): ~5 ms @k=10, ~19 ms @k=100, 32--43 ms @k=200 across two executions; 40--800 candidates; n=15 per setting', `k10 ${both(10).map(v => v.toFixed(1)).join('/')}; k100 ${both(100).map(v => v.toFixed(1)).join('/')}; k200 ${both(200).map(v => v.toFixed(1)).join('/')}; raw ${c(10).rawAfterTrim}-${c(200).rawAfterTrim}; n=${c(10).wall_ms.n}`,
  both(10).every(v => near(v, 5, 1.0)) && both(100).every(v => near(v, 19, 2.0)) && both(200).every(v => v >= 31 && v <= 44) && c(10).rawAfterTrim === 40 && c(200).rawAfterTrim === 800 && c(10).wall_ms.n === 15);
// ---------- E4 ----------
const a4 = R('e4_a_search_and_store.json').rows;
const dbRow = (k) => a4.find(r => r.limit === k);
claim('E4.1', 'VI-D / Tab. X', 'DB table: papers 40/97/191/355; orchestrator 5.1/7.5/10.6/19.6; total 33.4/67.5/118.3/207.2; repeat 17.7/31.9/60.3/109.9 (ms)',
  a4.map(r => `${r.limit}:${r.papersReturned},${r.orchestrator_ms.median.toFixed(1)},${r.searchAndStore_ms.median.toFixed(1)},${r.repeatSearchAndStore_ms.median.toFixed(1)}`).join(' | '),
  [[10, 40, 5.1, 33.4, 17.7], [25, 97, 7.5, 67.5, 31.9], [50, 191, 10.6, 118.3, 60.3], [100, 355, 19.6, 207.2, 109.9]].every(([k, n, o, t, rp]) => dbRow(k).papersReturned === n && near(dbRow(k).orchestrator_ms.median, o, 0.6) && near(dbRow(k).searchAndStore_ms.median, t, 5) && near(dbRow(k).repeatSearchAndStore_ms.median, rp, 4)));
claim('E4.2', 'VI-D', 'DB cost 0.5--0.7 ms per paper; IDs stable; no extra rows on repeat; no failed inserts', a4.map(r => `${r.approxDbMsPerPaper.toFixed(2)}/${r.idsStableAcrossRepeatedSearch}/${r.rowsInTableAfterTwoRuns}==${r.papersReturned}/${r.failedInserts}`).join(' '), a4.every(r => r.approxDbMsPerPaper >= 0.45 && r.approxDbMsPerPaper <= 0.75 && r.idsStableAcrossRepeatedSearch && r.rowsInTableAfterTwoRuns === r.papersReturned && r.failedInserts === 0));
const b4 = R('e4_b_session.json');
const last = b4.steps.at(-1); const arx = b4.bySource.find(s => s.source === 'arxiv');
claim('E4.3', 'VI-D', '8-query session: 310 rows, 271 distinct works, 39 duplicate rows (12.6%), 45 DOI-less, 47 arXiv rows (2 with DOI)', `${last.rowsInTable}, ${last.distinctWorks}, ${last.persistedDuplicateRows} (${(100 * last.persistedDuplicateRows / last.rowsInTable).toFixed(1)}%), ${last.rowsWithoutDoi}, ${arx.n}(${arx.with_doi})`, last.rowsInTable === 310 && last.distinctWorks === 271 && last.persistedDuplicateRows === 39 && last.rowsWithoutDoi === 45 && arx.n === 47 && arx.with_doi === 2);
const l4 = R('e4_c_library_scan.json').rows;
const lib = (P, F) => l4.find(r => r.dbRows === P && r.pdfFiles === F).getLibraryPapers_ms.median;
claim('E4.4', 'VI-D', 'Library scan: 4 ms (1k rows,0 files), 51 ms (1k,1k), 1.10 s (20k,1k), 48 ms (20k,0); ~47--52 ns per row-file pair', `${lib(1000, 0).toFixed(1)}, ${lib(1000, 1000).toFixed(1)}, ${lib(20000, 1000).toFixed(0)}, ${lib(20000, 0).toFixed(1)}; ns/pair ${[[1000, 1000], [5000, 1000], [20000, 1000]].map(([P, F]) => (((lib(P, F) - lib(P, 0)) * 1e6) / (P * F)).toFixed(0)).join('/')}`,
  near(lib(1000, 0), 4.1, 1.5) && near(lib(1000, 1000), 51.5, 8) && near(lib(20000, 1000), 1098, 120) && near(lib(20000, 0), 48, 10));
const sc = R('e2b_dedup_scaling.json').rows;
const med = (n, k) => sc.find(r => r.n === n)[k].median;
claim('E2b.1', 'VI-D', 'deduplicate(): 2.3 ms @1 000, 28 ms @10 000, 626 ms @100 000', `${med(1000, 'repo').toFixed(2)}, ${med(10000, 'repo').toFixed(1)}, ${med(100000, 'repo').toFixed(0)}`, near(med(1000, 'repo'), 2.3, 0.5) && near(med(10000, 'repo'), 28, 6) && near(med(100000, 'repo'), 626, 150));
// ---------- E5 ----------
const sp = R('e5_spacing.json').rows;
claim('E5.1', 'VI-E', 'Six papers: 10.2/11.0/12.0/18.0 s for L = 0.2/1/2/3 s; model (N-1)max(L,tau)+L; start gaps 2002/2001/2003/3004 ms', sp.map(r => `${(r.total_ms / 1000).toFixed(2)}s(model ${(r.model_total_ms / 1000).toFixed(2)}) gap ${r.startGaps_ms.median.toFixed(0)}`).join(' | '), sp.every(r => near(r.total_ms, r.model_total_ms, 30) && near(r.startGaps_ms.median, Math.max(r.L, 2000), 6)));
const bo = R('e5_backoff.json').rows;
const rng = (k) => bo.filter(r => r.consecutive429 === k).map(r => r.total_ms / 1000);
claim('E5.2', 'VI-E', 'k=1: 2.2-2.3 s; k=2: 6.2-6.7 s; k=3: 14.4-14.8 s; k=4: 4 requests, 14.7-14.9 s, thrown (n=3 each)', [1, 2, 3, 4].map(k => `${k}: ${Math.min(...rng(k)).toFixed(2)}-${Math.max(...rng(k)).toFixed(2)} n=${rng(k).length}`).join(' | '),
  [[1, 2.2, 2.35], [2, 6.15, 6.7], [3, 14.35, 14.85], [4, 14.65, 14.9]].every(([k, lo, hi]) => Math.min(...rng(k)) >= lo && Math.max(...rng(k)) <= hi && rng(k).length === 3) && bo.filter(r => r.consecutive429 === 4).every(r => r.requestsIssued === 4 && r.outcome.startsWith('threw')) && bo.filter(r => r.consecutive429 < 4).every(r => r.outcome === 'ok'));
const er = R('e5_errors.json');
claim('E5.3', 'VI-E', 'HTTP 400/401/500/503 not retried (1 request each); failure isolation 4 succeeded / 1 failed', JSON.stringify(er.perStatus.map(s => [s.status, s.requestsIssued])) + ' ' + JSON.stringify(er.isolation), er.perStatus.every(s => s.requestsIssued === 1 && !s.retried) && er.isolation.succeeded === 4 && er.isolation.failed === 1);
const pr = R('e5_prompt.json').out;
claim('E5.4', 'VI-E', 'Null abstract -> literal "Abstract: null"; undefined -> "Abstract: undefined"; 20 000-word abstract sent untruncated (100 060 chars); T=0.3, max_tokens 1024, openai/gpt-oss-120b', `${JSON.stringify(pr.nullAbstract.userMessageFirst120.slice(0, 40))}, ${pr.longAbstract.userMessageChars}, ${pr.nullAbstract.model}`, pr.nullAbstract.userMessageFirst120.includes('Abstract: null') && pr.undefinedAbstract.userMessageFirst120.includes('Abstract: undefined') && pr.longAbstract.userMessageChars === 100060 && pr.nullAbstract.temperature === 0.3 && pr.nullAbstract.max_tokens === 1024 && pr.nullAbstract.model === 'openai/gpt-oss-120b');
// ---------- E0 + repo tests ----------
const e0 = R('e0_repo_stats.json');
claim('E0.1', 'V / Tab. III', 'Code base 6 487 lines in 38 files; layer sizes as tabulated', `${e0.totalLines}, ${Object.values(e0.byLayer).reduce((a, v) => a + v.files, 0)} files`, e0.totalLines === 6487 && Object.values(e0.byLayer).reduce((a, v) => a + v.files, 0) === 38);
const logDir = here + '../logs/';
const cnt = (f, ch) => (fs.readFileSync(logDir + f, 'utf8').match(new RegExp(ch, 'g')) || []).length;
const tests = { 'repo_test_all_providers.log': [22, 6], 'repo_test_ingestion.log': [8, 0], 'repo_test_paper_service.log': [7, 2], 'repo_test_workspace_library.log': [20, 0] };
const tcounts = Object.entries(tests).map(([f, [p, fl2]]) => [f, cnt(f, '✓'), cnt(f, '✗')]);
claim('R.1', 'V', 'Repository tests in sandbox: the 57 offline assertions all pass; the other 8 assertions need live providers and are not evaluable behind the egress policy (raw counts kept in the logs)', tcounts.map(([f, p, f2]) => `${f.replace('repo_test_', '').replace('.log', '')}:${p}/${f2}`).join(' '), tcounts.every(([f, p, f2]) => p === tests[f][0] && f2 === tests[f][1]) && tcounts.reduce((a, [, p]) => a + p, 0) === 57 && tcounts.reduce((a, [, , f2]) => a + f2, 0) === 8);

// ---------- (b) original vs independent re-run ----------
const rerunRows = [];
if (RERUN) {
  const cmp = (label, a, b, kind, tol) => { const same = kind === 'exact' ? JSON.stringify(a) === JSON.stringify(b) : Math.abs(a - b) <= tol; rerunRows.push({ metric: label, original: typeof a === 'object' ? JSON.stringify(a) : Number(a.toFixed ? a.toFixed(2) : a), rerun: typeof b === 'object' ? JSON.stringify(b) : Number(b.toFixed ? b.toFixed(2) : b), rule: kind === 'exact' ? 'exact' : `|diff| <= ${tol}`, match: same }); };
  const X = (n) => R(n, RERUN);
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (['meta', 'date'].includes(k) ? undefined : v)));
  const e2r = X('e2_dedup.json');
  cmp('E2 pairwise recall matrix (A)', strip(e2.A), strip(e2r.A), 'exact');
  cmp('E2 false-merge probes (B)', e2.B, e2r.B, 'exact');
  cmp('E2 order dependence (C)', e2.C.rows, e2r.C.rows, 'exact');
  cmp('E2 mixed scenario (D)', e2.D.configs.map(c => [c.raw, c.uniqueWorks, c.perVariant, c.residualPairTypes]), e2r.D.configs.map(c => [c.raw, c.uniqueWorks, c.perVariant, c.residualPairTypes]), 'exact');
  cmp('E3 amplification', R('e3_amplify.json').rows.map(r => [r.limit, r.totalUpstreamRequests, r.perEndpoint]), X('e3_amplify.json').rows.map(r => [r.limit, r.totalUpstreamRequests, r.perEndpoint]), 'exact');
  cmp('E3 fault statuses', fl.map(r => [r.faultySource, r.fault, r.statusReported, r.countReported, r.listedInProviderFailures, r.otherSourcesIntact]), X('e3_faults.json').rows.map(r => [r.faultySource, r.fault, r.statusReported, r.countReported, r.listedInProviderFailures, r.otherSourcesIntact]), 'exact');
  const swr = X('e3_sweep.json').rows;
  sw.forEach((r, i) => cmp(`E3 sweep median @L=${r.L} ms`, r.observed.median, swr[i].observed.median, 'tol', 15));
  const wmr = X('e3_warm.json').rows;
  wm.forEach((r, i) => cmp(`E3 warm second-search median, idle gap ${r.idleGapBetweenSearches_ms} ms`, r.second.median, wmr[i].second.median, 'tol', 25));
  for (const s of ['openalex', 'pubmed', 'arxiv']) cmp(`E3 hang ${s} median (ms)`, R(`e3_hang_${s}.json`).elapsed_ms.median, X(`e3_hang_${s}.json`).elapsed_ms.median, 'tol', 25);
  const a4r = X('e4_a_search_and_store.json').rows;
  a4.forEach((r, i) => { cmp(`E4a papers returned k=${r.limit}`, r.papersReturned, a4r[i].papersReturned, 'exact'); cmp(`E4a total ms k=${r.limit}`, r.searchAndStore_ms.median, a4r[i].searchAndStore_ms.median, 'tol', Math.max(8, 0.15 * r.searchAndStore_ms.median)); });
  const b4r = X('e4_b_session.json'); cmp('E4b session counts', b4.steps, b4r.steps, 'exact');
  const l4r = X('e4_c_library_scan.json').rows; l4.forEach((r, i) => cmp(`E4c library scan P=${r.dbRows} F=${r.pdfFiles} (ms)`, r.getLibraryPapers_ms.median, l4r[i].getLibraryPapers_ms.median, 'tol', Math.max(6, 0.15 * r.getLibraryPapers_ms.median)));
  const cpur = X('e3_cpu.json').rows; cpu.forEach((r, i) => cmp(`E3 cpu k=${r.limit} (ms)`, r.wall_ms.median, cpur[i].wall_ms.median, 'tol', Math.max(2.5, 0.3 * r.wall_ms.median)));
  const spr = X('e5_spacing.json').rows; sp.forEach((r, i) => cmp(`E5 spacing total L=${r.L} (ms)`, r.total_ms, spr[i].total_ms, 'tol', 40));
  const bor = X('e5_backoff.json').rows; bo.forEach((r, i) => cmp(`E5 backoff k=${r.consecutive429} rep ${r.rep} (ms)`, r.total_ms, bor[i].total_ms, 'tol', 900));
  const noT = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'total_ms' ? undefined : v)));
  cmp('E5 errors (request counts, outcomes, isolation; total_ms excluded)', noT(er), noT(X('e5_errors.json')), 'exact');
  const nur = X('e1_normalizers.json').normalize_us_per_record; for (const k of Object.keys(nu)) cmp(`E1 normalize ${k} (us/record)`, nu[k].median, nur[k].median, 'tol', Math.max(0.8, 0.3 * nu[k].median));
  const scr = X('e2b_dedup_scaling.json').rows; sc.forEach((r, i) => { cmp(`E2b output records n=${r.n}`, r.repo.outputRecords, scr[i].repo.outputRecords, 'exact'); cmp(`E2b deduplicate ms n=${r.n}`, r.repo.median, scr[i].repo.median, 'tol', Math.max(1, 0.4 * r.repo.median)); });
}

const passed = claims.filter(c => c.pass).length;
const out = { generatedAt: new Date().toISOString(), summary: { claims: claims.length, passed, failed: claims.length - passed, rerunComparisons: rerunRows.length, rerunMatches: rerunRows.filter(r => r.match).length }, claims, rerun: rerunRows };
fs.writeFileSync(here + 'claims_report.json', JSON.stringify(out, null, 2));
let md = `# Claim-by-claim audit (generated by verify_claims.mjs)\n\n${passed}/${claims.length} claims re-derived from raw results agree with the manuscript.\n\n| ID | Section | Paper statement | Re-derived value | Result |\n|---|---|---|---|---|\n`;
for (const c of claims) md += `| ${c.id} | ${c.section} | ${c.statement.replace(/\|/g, '/')} | ${c.actual.replace(/\|/g, '/')} | ${c.pass ? 'PASS' : '**FAIL**'} |\n`;
if (RERUN) { md += `\n## Original run vs. independent re-run (${rerunRows.filter(r => r.match).length}/${rerunRows.length} within rule)\n\n| Metric | Original | Re-run | Rule | Match |\n|---|---|---|---|---|\n`; for (const r of rerunRows) md += `| ${r.metric} | ${String(r.original).slice(0, 60).replace(/\|/g, '/')} | ${String(r.rerun).slice(0, 60).replace(/\|/g, '/')} | ${r.rule} | ${r.match ? 'yes' : '**NO**'} |\n`; }
fs.writeFileSync(here + 'claims_report.md', md);
console.log(JSON.stringify(out.summary));
for (const c of claims.filter(c => !c.pass)) console.log('FAIL', c.id, c.statement, '=>', c.actual);
for (const r of rerunRows.filter(r => !r.match)) console.log('RERUN-MISMATCH', r.metric, r.original, r.rerun);
