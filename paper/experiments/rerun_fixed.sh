#!/usr/bin/env bash
# Re-runs the experiments whose harness was corrected after the first full sweep (see paper, Sec. Methodology).
cd "$(dirname "$0")"; export DB_NAME=rie_bench
node e3_orchestrator.mjs cpu > ../logs/e3_cpu.log 2>&1
node e4_db.mjs a > ../logs/e4_a.log 2>&1
node e2b_dedup_scaling.mjs > ../logs/e2b.log 2>&1
node e2_dedup.mjs > ../logs/e2.log 2>&1
echo RERUN DONE >> ../logs/rerun.log
