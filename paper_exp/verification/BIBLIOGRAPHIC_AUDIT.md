# Bibliographic audit

Scope: all 27 entries of `references.bib` (every one is cited in `main.tex`; no entry is unused and no citation key is unresolved, checked by script).
Audit date: 3 Nov 2026.

## Method and its limits (read first)

* **Channel.** Direct retrieval of publisher/DOI/Crossref/arXiv/ACL/PMC pages was **not possible** in the cloud session (the fetch tool could not resolve `api.crossref.org`, `arxiv.org`, `aclanthology.org`, `pmc.ncbi.nlm.nih.gov`; they are outside the session's allowed network domains). Every entry was therefore verified through **web-search result records** that quote the publisher page, the ACL Anthology, PubMed/PMC, dblp, the arXiv listing, or the library catalogue record, and an entry counts as *verified* only where **at least two independent records agree** on authors, title, venue, year, volume/issue/pages and DOI. DOIs were not resolved against doi.org.
* **Claims.** Each citation was checked for whether the sentence it supports is consistent with what the source is recorded as saying (abstract-level; full texts were not read).
* **What "verified" does not mean.** It does not mean the full text was read.

## Corrections made in this revision

| Entry | Problem found | Correction |
|---|---|---|
| `tang2024llmreview` (Tang, Duan, Cai) | Cited as an arXiv preprint (2412.13612) whose early title was "Are LLMs good literature review writers?". The work was published in **EMNLP 2025 (main)**. | Replaced by `tang2025llmreview`: *Proc. 2025 Conf. on Empirical Methods in Natural Language Processing*, Suzhou, China, ACL, **pp. 1602–1617**, **DOI 10.18653/v1/2025.emnlp-main.83**, title as published ("Large language models for automated literature review: An evaluation of reference generation, abstract writing, and review composition"); authors per ACL Anthology / EMNLP programme: Xuemei Tang, Xufeng Duan, Zhenguang Cai. Key renamed in `main.tex`. |
| `gusenbauer2020which` | Volume, issue and pages were missing. | Added **11(2), 181–217** (consistent across the records found; online Jan 2020). |
| `arxivapi` | Titled "arXiv API User's Manual and Terms of Use" although the rate-limit statement (no more than one request every three seconds, single connection) comes from the official **Terms of Use for arXiv APIs** page. | Retitled "Terms of Use for arXiv APIs", URL `https://info.arxiv.org/help/api/tou.html` (page located by search; its content as summarized by the search record). |
| `lewis2020retrieval` | Page range could not be confirmed. | Pages omitted (none was asserted); proceedings URL added; first author "Patrick Lewis" and the NeurIPS 2020 / vol. 33 venue confirmed. |
| `alperin2024analysis` | Risk of being read as a journal article. | Note "Preprint; no journal version was located" added. A Scientometrics DOI that surfaced in search (10.1007/s11192-025-05293-3) belongs to a *different* paper (Culbert et al.) and was **not** used. |
| `main.tex` Related Work | Statements stronger than the cited sources support (see below). | Reworded: Piwowar (“uneven” → "an estimated 28 % or more … open access"), Shokouhi & Si (removed "query translation"; "resource description, resource selection and result merging"), Dean & Barroso ("latency of the slowest component dominates" → "occasional slow components can dominate overall latency of a fan-out service"), Elmagarmid/Christen ("blocking keys, … clustering" → "field-similarity metrics, indexing (blocking) and classification"), Bramer/Rathbone (the unsupported "differ markedly in sensitivity" replaced by the two verified statements, including Rathbone's 42.9 % [42.86 %] more duplicates than EndNote on a 1,988-citation benchmark). An unsupported absolute ("none evaluates a client that merges them locally") was softened. |

## Per-entry record

Key: **OK** = authors, title, year, venue and (where applicable) volume/issue/pages/DOI agree across records.

| # | Key | Final citation (as in `references.bib`) | Status | Notes |
|---|---|---|---|---|
| 1 | priem2022openalex | Priem, Piwowar, Orr, "OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts," arXiv:2205.01833, 2022 (DOI 10.48550/arXiv.2205.01833) | OK | Submitted 4 May 2022, v2 17 Jun 2022; written for the 26th STI Conference; the arXiv version is cited. |
| 2 | lo2020s2orc | Lo, Wang, Neumann, Kinney, Weld, "S2ORC…," ACL 2020, pp. 4969–4983, 10.18653/v1/2020.acl-main.447 | OK | ACL Anthology record. |
| 3 | kinney2023semantic | Kinney et al., "The Semantic Scholar Open Data Platform," arXiv:2301.10140, 2023 | OK | 48 authors; "and others" is used. v2 dated 25 Apr 2025 (living document). |
| 4 | hendricks2020crossref | Hendricks, Tkaczyk, Lin, Feeney, *QSS* 1(1):414–427, 2020, 10.1162/qss_a_00022 | OK | Crossref/MIT Press records. |
| 5 | ferguson2021europepmc | Ferguson et al., "Europe PMC in 2020," *NAR* 49(D1):D1507–D1514, 2021, 10.1093/nar/gkaa994 | OK | Online 12 Nov 2020, January 2021 issue; first author Christine Ferguson; full roster not reproduced ("and others"). |
| 6 | sayers2022eutilities | Sayers, "A General Introduction to the E-utilities," NCBI Bookshelf NBK25497 (created 2009, updated 17 Nov 2022) | OK | Rate limit (3 requests/s without key) matches the PubMed adapter's comment. |
| 7 | arxivapi | arXiv, "Terms of Use for arXiv APIs" | **Corrected** | Official page found by search; the user-manual page itself was not retrievable; secondary sources agree on the three-second rule. |
| 8 | elmagarmid2007duplicate | Elmagarmid, Ipeirotis, Verykios, *IEEE TKDE* 19(1):1–16, 2007, 10.1109/TKDE.2007.250581 | OK | One BibSonomy record lists a different DOI (…2007.9); the IEEE record matches ours. |
| 9 | fellegi1969theory | Fellegi, Sunter, *JASA* 64(328):1183–1210, 1969, 10.2307/2286061 | OK | JSTOR DOI. A Taylor & Francis DOI could not be confirmed and is not used. |
| 10 | christen2012data | Christen, *Data Matching*, Springer, 2012, 10.1007/978-3-642-31164-2 | OK | 272 pp.; chapters on pre-processing, indexing, comparison, classification, evaluation. |
| 11 | bramer2016dedup | Bramer et al., *JMLA* 104(3):240–243, 2016, 10.3163/1536-5050.104.3.014 | OK | A later correction to Table 1 (row C3) exists; not material to the statement cited. |
| 12 | rathbone2015better | Rathbone, Carter, Hoffmann, Glasziou, *Systematic Reviews* 4:6, 2015, 10.1186/2046-4053-4-6 | OK | Published Jan 2015; the PDF header reads "2014, 4:6"; PMC/Springer/PubMed give 2015, which is used. |
| 13 | gusenbauer2020which | Gusenbauer, Haddaway, *Res. Synth. Methods* 11(2):181–217, 2020, 10.1002/jrsm.1378 | **Corrected** | Volume/issue/pages added. |
| 14 | visser2021large | Visser, van Eck, Waltman, *QSS* 2(1):20–41, 2021, 10.1162/qss_a_00112 | OK | |
| 15 | alperin2024analysis | Alperin, Portenoy, Demes, Larivière, Haustein, arXiv:2404.17663, 2024 | OK (preprint) | No journal version found. |
| 16 | piwowar2018state | Piwowar et al., *PeerJ* 6:e4375, 2018, 10.7717/peerj.4375 | OK | Abstract: at least 28 % of the literature is OA. |
| 17 | nicholson2021scite | Nicholson et al., *QSS* 2(3):882–898, 2021, 10.1162/qss_a_00146 | OK | |
| 18 | lewis2020retrieval | Lewis et al., NeurIPS 33 (2020); arXiv:2005.11401 | OK, **pages unverified** | See corrections. |
| 19 | gao2023retrieval | Gao et al., arXiv:2312.10997, 2023 | OK | Versions v1–v5; later versions have a longer author list; "and others" used. |
| 20 | lala2023paperqa | Lála et al., arXiv:2312.07559, 2023 | OK | Six authors as listed. |
| 21 | skarlinski2024language | Skarlinski et al., arXiv:2409.13740, 2024 | OK | Nine authors; "and others". |
| 22 | ji2023survey | Ji et al., *ACM Comput. Surv.* 55(12), art. 248 (38 pp.), 2023, 10.1145/3571730 | OK | 11 authors (the arXiv list includes W. Dai); "and others". |
| 23 | tang2025llmreview | Tang, Duan, Cai, EMNLP 2025, pp. 1602–1617, 10.18653/v1/2025.emnlp-main.83 | **Corrected** | See corrections. |
| 24 | openai2025gptoss | OpenAI, "gpt-oss-120b & gpt-oss-20b model card," arXiv:2508.10925, 2025 | OK | Submitted 8 Aug 2025; Apache-2.0 open weights. Architecture/safety figures were not used in the paper. |
| 25 | dean2013tail | Dean, Barroso, *CACM* 56(2):74–80, 2013, 10.1145/2408776.2408794 | OK | |
| 26 | shokouhi2011federated | Shokouhi, Si, *Found. Trends Inf. Retr.* 5(1):1–102, 2011, 10.1561/1500000010 | OK | Scope wording corrected; abstract/TOC of the monograph itself was not retrieved (scope taken from a 2023 survey that cites it). |
| 27 | cormack2009reciprocal | Cormack, Clarke, Büttcher, SIGIR 2009, pp. 758–759, 10.1145/1571941.1572114 | OK | |

## Citation-support audit (statement → sources → assessment)

| Location | Statement | Sources | Assessment |
|---|---|---|---|
| Introduction ¶1 | Open scholarly-metadata services exist (OpenAlex, S2, Crossref, Europe PMC, PubMed, arXiv) | 1–7 | Supported (descriptions of each service). |
| Introduction ¶1 | Coverage/completeness/citation counts differ between sources | 14, 13, 15 | Supported: Visser et al. compare coverage and citation-link completeness; Gusenbauer & Haddaway compare retrieval qualities; Alperin et al. report metadata accuracy/completeness issues. |
| Introduction ¶1 | LLM summaries carry a documented risk of unsupported output | 22, 23 | Supported (hallucination survey; hallucinated references in LLM review writing). |
| Introduction ¶5 | Union-find and fielded matching are standard in record linkage | 9, 8, 10 | Supported at survey/textbook level. |
| Related Work A | OpenAlex introduced as replacement for Microsoft Academic Graph | 1 | Supported (abstract). |
| Related Work A | Only part of the literature is open access | 16 | Supported after rewording (≥ 28 % in the study). |
| Related Work B | Federated search sub-problems; RRF combines rankings; tail latency | 26, 27, 25 | Supported after rewording. Hedged requests (Discussion) are discussed in Dean & Barroso. |
| Related Work C | Record linkage / dedup techniques; systematic-review dedup | 9, 8, 10, 11, 12 | Supported after rewording (42.9 % figure is from Rathbone et al.). |
| Related Work D | RAG, PaperQA/PaperQA2, scite, hallucination, gpt-oss | 18, 19, 20, 21, 17, 22, 23, 24 | Supported at abstract level. |

## Unresolved issues

1. **Direct verification** against doi.org/Crossref/arXiv/ACL pages was impossible in this session; entries rest on agreeing search records (see Method). A reader with network access can run `curl -s https://api.crossref.org/works/<DOI>` for each DOI to confirm.
2. **Lewis et al. (NeurIPS 2020)** page range not confirmed; omitted.
3. **Truncated author lists** ("and others") for entries 3, 5, 18, 19, 21, 22: first authors verified; complete lists were not reproduced.
4. **arXiv terms**: the statement is attributed to the official Terms-of-Use page, whose text was seen only through a search summary; the arXiv API user manual was not retrieved.
5. **Shokouhi & Si**: scope sentence relies on a citing survey, not on the monograph's abstract.
6. Third-party reports that arXiv changed or tightened its rate limits in 2026 could not be confirmed from an official source and are **not** used in the paper.
