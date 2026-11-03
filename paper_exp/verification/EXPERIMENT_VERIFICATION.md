# Experimental verification report

Subject: `paper_exp/main.tex` (IEEE conference paper on the Research Intelligence Engine, RIE), revision of 3 Nov 2026.
Application baseline: commit `bf2d3a3`. Application source modified: **none** (see §3).

## 0. Evidence classes

| Class | Meaning | Status in this report |
|---|---|---|
| **[S]** simulated | Unmodified RIE modules against a deterministic fetch emulator (+ real local PostgreSQL 16.15) | Audited and **independently re-run** (§2, §4) |
| **[R]** repository tests | The repo's four test scripts executed in the cloud sandbox, twice with network access (`logs_online/run1`, `run2`: 78/78 assertions pass each time) and once earlier without network (`logs/`: 57 evaluable, all passing; 8 needing live providers not evaluable) | Re-counted from logs (claims R.run1, R.run2, R.offline) |
| **[L]** live | One session of the real Windows desktop app, recorded by the author from in-app logs | **Taken as stated by the author; not reproducible or independently checked here**; reported separately in the paper |
| **[C]** code inspection | Reading the source (file/line evidence) | Spot-checked against source; not executed |
| *unverified* | Anything above that was not executed or measured | Listed in §6 |

## 1. What was audited and how

1. **Claim-by-claim audit** (`verify_claims.mjs` → `claims_report.md/json`): 39 quantitative statements in the manuscript are re-derived from the raw JSON in `results/` (counts, medians, ranges, sample sizes, model predictions). **39/39 agree.**
2. **Independent re-run**: the final `experiments/run_all.sh` was executed a second time from a clean copy of the harness in a separate directory; raw output is preserved in `results_rerun/` and `logs_rerun/`. `verify_claims.mjs ../results_rerun` compares the two executions (75 quantities; exact match required for deterministic outputs, a tolerance for wall-clock timings).
3. **Module usage** (`verify_module_usage.mjs` → `module_usage_report.md/json`): imports per experiment, `git diff` against the baseline, orchestrator-equivalence of the replicated pipeline, renderer→normalizer fidelity.
4. **Source cross-check**: every code-level statement in the paper (timeouts, throttles, error handling, prompt text, schema, README drift) was checked against the source with line numbers (§5).
5. **Environment** captured by `experiments/env_info.mjs` → `results/environment.json` (Node v22.23.4, PostgreSQL 16.15, `pg` 8.20.0, `xml2js` 0.6.2, Ubuntu 24.04.5, 4 vCPU Intel Xeon 2.3 GHz, 16 GB).

## 2. Results of the independent re-run

* **75 compared quantities; 73 within the stated rule.**
* Exactly reproduced (byte-identical structured output): all of E2 (pairwise recall matrix, false-merge probes, order dependence, mixed scenario), request amplification, fault-injection statuses, database row counts and session duplicates, AI request counts/outcomes/prompts, E2b output record counts.
* Wall-clock results dominated by injected delays (latency sweep, warm start, hang timeouts, AI spacing, back-off, DB cost split, library scan) agreed within the tolerances (typically ≤ 15 ms).
* **Two mismatches, both CPU microtimings** (reported, not hidden, and not adjusted away):

| Quantity | Original | Re-run | Consequence for the paper |
|---|---|---|---|
| E1 OpenAlex normalizer (µs/record, median) | 6.57 | 3.60 | Paper now reports **ranges over both executions** (3.1–6.6 µs), states that providers varied up to ~45 % between runs, and **makes no provider ranking claim** (the earlier draft implied OpenAlex and PubMed were costliest). |
| E3 CPU, k = 50 (ms, median of 15) | 11.1 | 14.7 | Paper quotes ~5 ms (k=10), ~19 ms (k=100) and 32–43 ms (k=200), i.e. ranges across both executions; k=50 is not quoted. |

  Other sub-10 ms CPU quantities were within tolerance but are likewise noisy (e.g. k=200 orchestration 43.2 vs 32.0 ms; arXiv XML parse for 100 entries 2.4 vs 3.8 ms); the paper treats all such figures as orders of magnitude.

* **Provenance of `results/`.** The numbers in the paper come from `results/`, which was assembled from one full sweep plus targeted re-runs of experiments whose harness was corrected during development (E2 applicability rule, E3 CPU / E4a PubMed-throttle masking, E5 spacing model field, E2b added). `results_rerun/` is a **complete, single, uninterrupted execution of the final `run_all.sh`**; it is the cleaner provenance and agrees with `results/` as described above.

## 3. Are the experiments using the real application modules?

(Details: `module_usage_report.md`.)

* **No application file was modified**: `git diff --stat bf2d3a3 -- . ':!paper_exp'` is empty.
* **Real modules driven**: `ingestion/search-orchestrator.js`, `dedupe.js`, `ranking.js`, all six `sources/*.js` adapters and six `normalizers/*.js`, `services/db.js`, `schema.js`, `paper-service.js`, `ai-service.js`, `ingestion/ai-pipeline.js`. Only `globalThis.fetch` is replaced (the emulator).
* **Explicitly identified non-application code** (experimental variants / harness): `lib/dedupe_variants.mjs` (`uf_repo_keys`, `uf_relaxed`; `strictHash` restates the repo key only for the applicability test and as a union-find key), `lib/emulator.mjs`, `lib/render.mjs`, `lib/corpus.mjs`, `lib/pipeline.mjs`.
* **Two places that call library functions directly (disclosed in the paper)**: E2 part D replicates orchestrator steps 1–3 using the same adapters/normalizers/`rankPapers` — verified against the real orchestrator on **full record sets and ranked order** for three queries (58/58, 55/55, 123/123; all identical), plus output sizes for the two queries inside E2 (58, 133); E1 times `xml2js.parseStringPromise` with the adapters' options rather than through the adapters.
* **Renderer fidelity**: 200 records per provider round-tripped through the real normalizer agree with ground truth in every field except Europe PMC's first-author string (rendered as "Surname Initial" by design, mirroring the repository's own fixture `Doudna JA`).
* **Limitation**: the raw provider payloads are reconstructions of the shapes the normalizers read, **not recorded live traffic**.

## 4. Discrepancies found and corrected during this revision

| # | Finding | Correction |
|---|---|---|
| 1 | Text claimed that for the three-record order test "half of the works stay duplicated"; the data show that in 4 of 6 orders **every** work is output twice (2 000 records for 1 000 works). | Sentence corrected. |
| 2 | Text said Europe PMC issues a Crossref look-up "per hit"; the code (`europepmc.js` l.49–51) skips hits **without a DOI**. All emulated hits have DOIs, so the measured counts (7 + k) are right but the general statement was not. | Text, Table I and the request-count formula now say "hits that carry a DOI" ($n_{epmc}\le k$). |
| 3 | The CPU and DB-cost experiments originally included PubMed, whose adapter throttle (350 ms ×2 between back-to-back searches) masked CPU cost (first CPU run showed ≈700 ms independent of k). | Experiments re-designed (arXiv and PubMed excluded for these two measurements), re-run, old output overwritten; the throttle effect is stated as a [C] model remark, not as a measurement. |
| 4 | E5 spacing result field `model_total_ms` used $N\max(L,\tau)$ instead of $(N-1)\max(L,\tau)+L$. | Fixed in script; re-run; measured totals (10.2/11.0/12.0/18.0 s) match the corrected model. |
| 5 | E2 "diacritics" probe counted works whose first author had no diacritics (recall 0.57). | Applicability rule restricted to the fields the key uses (title, first author, year); now 0.00 on n = 161. |
| 6 | Arbitrary fallback arXiv id for work-less arXiv records merged ~516 unrelated records in the order test (artifact). | Unique fallback id per work; re-run. |
| 7 | Microsecond/few-ms CPU timings were quoted from a single run. | Replaced by ranges over two executions; ranking claims removed (§2). |
| 8 | "Deterministic to that precision" (latency IQR). | Reworded to "highly repeatable". |
| 9 | Discussion said the application "already measures implicitly" provider latency. `providerStats` holds status and counts only. | Removed; stated that neither latency is recorded. |
| 10 | Draft implied that no live evidence existed. | Live session added as class [L], kept separate; abstract, evaluation, discussion, limitations and conclusion updated. |

## 5. Code-level (class [C]) statements checked against the source

| Statement in paper | Evidence |
|---|---|
| Adapter timeouts 15/30/15/15/15/25 s | `openalex.js:12`, `arxiv.js:11`, `semanticscholar.js:9`, `crossref.js:9`, `europepmc.js:9`, `pubmed.js:11` |
| arXiv 3 s inter-request throttle, 3·limit candidates, errors return `[]` | `arxiv.js:12,49,61,68,75` |
| OpenAlex relevance sort, 3·limit | `openalex.js:28,35` |
| PubMed 350 ms spacing; PDF link deliberately null | `pubmed.js:12`; `normalizers/pubmed.js:149` |
| S2 one retry after 2 s on 429 | `semanticscholar.js:42–46` |
| Europe PMC enrichment timeout 3 s, concurrent, DOI-only | `europepmc.js:47–56` |
| Per-provider rank + `slice(0, limit)`, UUIDs after dedup, `Promise.allSettled` | `search-orchestrator.js:86–141` |
| Dedup lookup chain, `continue` before key registration | `dedupe.js:56–77` |
| Ranking by year/citations, missing last | `ranking.js:10–14` |
| AI: 2 s interval, back-off `2^a·1000+U(0,500)`, 429-only retry, prompt with `${paper.abstract}`, T = 0.3 | `ai-service.js:19,78–81,41,60` |
| `ON CONFLICT DO NOTHING`; `SELECT * FROM papers`; substring match on `source_id`; PDF `fetch` without timeout | `paper-service.js:54,283,329,207` |
| Schema: `UNIQUE(source, source_id)`, unique DOI index; only table `papers` | `schema.js:30,35` |
| `contextIsolation: true`; settings written as plaintext JSON | `electron-main.js:60,208` |
| README drift (2 sources, Llama-3.3-70B, `analyses`/`collections`); Gemini comment | `README.md:12,53,107`; `src/analysis.js:2` |

## 6. Unverified or unverifiable items (stated in the paper)

* **All [L] observations** (author's live Windows session: query "transformers"; four providers × 2 papers; Semantic Scholar HTTP 429; 8 papers analyzed and saved in 27 s ≈ 3.4 s/paper; PostgreSQL initialization and Library display; PDF retrieval for OpenAlex and arXiv; editor start-up ≈ 1–2 s). Taken as true per the author; derived quantity: 27/8 = 3.375 s. **Not recorded**: configured limit, PubMed participation, PDF counts, search latency, per-paper AI latency, S2 retry behaviour, model id, machine/network, Windows/Electron versions. The AI time covers analysis and saving, not accuracy.
* Real provider latency, rate limits, payloads, overlap and duplicate rates, retrieval quality, LLM output quality: **not measured** (egress policy blocks the APIs).
* The PDF-download path (no timeout / size limit), plaintext key storage and IPC surface: **[C] only**.
* Absolute timings on other hardware or with a networked database.
* The Electron GUI, editor behaviour and Pandoc export were not run in the cloud.

## 7. Repository tests with network access (added after network was enabled)

* Runs: `NODE_USE_ENV_PROXY=1 node --import experiments/https_shim.mjs test/<script>.js` for all four scripts, twice. Result both times: **36 + 8 + 14 + 20 = 78 assertions pass, 0 fail**.
* Why two settings were needed: Node's built-in `fetch` ignores the sandbox's `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1`; and `ingestion/sources/arxiv.js` uses the plain-HTTP URL `http://export.arxiv.org`, which the HTTPS-only proxy cannot carry, so `https_shim.mjs` upgrades `http://` to `https://` for outgoing `fetch` (test environment only; no test or application file changed). Without the shim, 4 arXiv-dependent assertions failed; without the proxy variable, 8.
* Caveat: no API keys were configured. OpenAlex and Semantic Scholar answered HTTP 429 in both runs; the tests tolerate this, so a passing suite does not imply every provider responded. On a machine with keys these providers should respond.
* The assertion total rose from 65 to 78 because several `test-paper-service.js` steps only execute when search returns results.
