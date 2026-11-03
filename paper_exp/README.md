# paper_exp — manuscript, experiments and verification

IEEE conference paper on the Research Intelligence Engine (RIE) in this repository, with everything needed to rebuild it
and to re-run the experiments. **No application source file is modified** (checked against baseline commit `bf2d3a3`;
see `verification/module_usage_report.md`).

| Path | Content |
|---|---|
| `main.tex`, `references.bib`, `main.pdf` | The paper (IEEEtran, conference), its bibliography, and the compiled PDF |
| `figures/` | SVG sources (`*.svg`), generators (`make_diagrams.py`, `make_charts.py`, `figlib.py`) and PDF conversions used by LaTeX |
| `experiments/` | Harness (`lib/`), experiment scripts `e0`–`e5`, `env_info.mjs`, and `run_all.sh` |
| `results/` | Raw JSON of every emulated experiment (class **[S]**), plus `environment.json` |
| `results_rerun/`, `logs_rerun/` | Raw JSON and logs of an independent, complete second execution of the final `run_all.sh` (for the verification report) |
| `logs/` | Console logs of the runs and of an earlier no-network execution of the repository's test scripts |
| `logs_online/run1`, `run2` | Two executions of the repository's four test scripts with network access (class **[R]**): 78/78 assertions pass in both |
| `verification/` | `EXPERIMENT_VERIFICATION.md`, `BIBLIOGRAPHIC_AUDIT.md`, `claims_report.*`, `module_usage_report.*`, and the audit scripts |

## Evidence classes (used throughout the paper)

* **[S]** unmodified RIE modules against an emulated upstream (and a real local PostgreSQL) — reproducible here.
* **[R]** the repository's own test scripts, run in the cloud sandbox (78/78 pass with network access; needs `NODE_USE_ENV_PROXY=1` and `experiments/https_shim.mjs` in the sandbox, see `logs_online/`).
* **[L]** one user-recorded live session of the Windows desktop application — recorded by the author from in-app logs;
  **not reproduced** and not a benchmark.
* **[C]** code inspection only.

## Rebuild the paper

```bash
cd figures && python3 make_diagrams.py && python3 make_charts.py
for f in fig_*.svg; do rsvg-convert -f pdf "$f" -o "${f%.svg}.pdf"; done   # needs librsvg2-bin
cd .. && pdflatex main && bibtex main && pdflatex main && pdflatex main
```

## Re-run the experiments

Requirements: Node.js ≥ 18; `npm ci --omit=dev --ignore-scripts` in the repository root; a local PostgreSQL with a database
`rie_bench` (user `postgres`, password `postgres`, `localhost:5432`).

```bash
experiments/run_all.sh                       # ~25 min; writes ../results and ../logs
node verification/verify_claims.mjs          # re-derives every number quoted in the paper from ../results
node verification/verify_module_usage.mjs    # checks that the harness drives the real modules
```

Do not run other CPU-heavy work during `run_all.sh`; several experiments are timing measurements. All randomness is seeded.
The AI experiments use a dummy API key and an emulated endpoint; no credentials are used anywhere.

## What cannot be reproduced here

The live observations [L] (Windows desktop, real providers, real Groq endpoint) and any measurement against the real
scholarly APIs or LLM: the cloud sandbox's egress policy blocks them. The paper reports the [L] observations as recorded by the author.
