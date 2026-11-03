#!/usr/bin/env bash
# Reproduce every experiment in the paper. Requirements: Node >= 18, `npm ci --omit=dev --ignore-scripts` in the repo root,
# and a local PostgreSQL with database `rie_bench` (user postgres / password postgres on localhost:5432) for E4.
# The whole sweep takes roughly 20 minutes (dominated by deliberate waits: the arXiv adapter's 3 s throttle,
# the AI service's 2 s inter-request interval and retry back-off, and real upstream timeouts in the hang test).
set -u
cd "$(dirname "$0")"
export DB_NAME=rie_bench
mkdir -p ../results ../logs
node e0_repo_stats.mjs   > ../logs/e0.log 2>&1
node e1_normalizers.mjs  > ../logs/e1.log 2>&1
node e2_dedup.mjs        > ../logs/e2.log 2>&1
for m in sweep warm amplify faults cpu; do echo "=== e3 $m"; node e3_orchestrator.mjs $m > ../logs/e3_$m.log 2>&1; done
for m in a b c; do echo "=== e4 $m"; node e4_db.mjs $m > ../logs/e4_$m.log 2>&1; done
for m in spacing backoff errors prompt; do echo "=== e5 $m"; node e5_ai.mjs $m > ../logs/e5_$m.log 2>&1; done
for s in openalex pubmed arxiv; do echo "=== e3 hang $s"; node e3_orchestrator.mjs hang $s 3 > ../logs/e3_hang_$s.log 2>&1; done
echo "ALL DONE"
