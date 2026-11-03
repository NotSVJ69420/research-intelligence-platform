#!/usr/bin/env python3
"""Charts generated directly from ../results/*.json (measured data only)."""
import json, os, sys
from figlib import *

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "results")


def load(name):
    p = os.path.join(RES, name)
    return json.load(open(p)) if os.path.exists(p) else None


def fmt_ms(v):
    return f"{v:g}"


def fig_latency():
    d = load("e3_sweep.json")
    if not d:
        return
    W, H = 360, 235
    s = SVG(W, H)
    rows = d["rows"]
    xs = [r["L"] for r in rows]
    ax = Axes(s, 52, 12, 292, 150, (0, 1100), (200, 30000), yscale="log", xlabel="Injected latency per upstream request, L (ms)",
              ylabel="Search wall-clock (ms)", xticks=[0, 250, 500, 750, 1000], yticks=[300, 1000, 3000, 10000, 30000],
              yfmt=lambda v: f"{int(v):,}".replace(",", " "))
    seq = [(r["L"], r["model_fully_sequential_ms"]) for r in rows if r["model_fully_sequential_ms"] > 0]
    srcseq = [(r["L"], r["model_source_sequential_ms"]) for r in rows]
    par = [(r["L"], r["model_parallel_ms"]) for r in rows]
    ax.polyline([a for a, _ in seq], [b for _, b in seq], C["grey"], dash="2 3", sw=1.4)
    ax.polyline([a for a, _ in srcseq], [b for _, b in srcseq], C["orange"], dash="5 3", sw=1.4)
    obs = [r["observed"]["median"] for r in rows]
    lo = [r["observed"]["p25"] for r in rows]
    hi = [r["observed"]["p75"] for r in rows]
    ax.errbars(xs, lo, hi, C["verm"])
    ax.polyline(xs, obs, C["verm"], sw=1.6, marker="o", msize=3.4)
    ax.polyline([a for a, _ in par], [b for _, b in par], C["blue"], sw=1.1)
    items = [("observed median (IQR bars, n=5)", C["verm"], None, "o"), ("model: adapters in parallel", C["blue"], None, None),
             ("model: adapters in series", C["orange"], "5 3", None), ("model: all requests serial", C["grey"], "2 3", None)]
    legend(s, 56, 196, items[:2], size=8.2, gap=12)
    legend(s, 56 + 170, 196, items[2:], size=8.2, gap=12)
    s.save(os.path.join(HERE, "fig_latency.svg"))


def fig_dedup():
    d = load("e2_dedup.json")
    if not d:
        return
    rows = [r for r in d["A"]["s_no_doi"] if r["perturbation"] != "none"]
    W, H = 360, 272
    s = SVG(W, H)
    x0, x1 = 148, 318
    top = 16
    rh = 20
    s.text(x0, 10, "Pairwise merge recall (record lacks a DOI)", size=8.8, weight="bold")
    for t in (0, 0.5, 1):
        px = x0 + t * (x1 - x0)
        s.line(px, top, px, top + rh * len(rows), stroke=GRID, sw=0.6)
        s.text(px, top + rh * len(rows) + 11, f"{t:g}", size=8.5, anchor="middle", fill=MUTED)
    for i, r in enumerate(rows):
        y = top + i * rh
        s.text(x0 - 5, y + 11.5, r["perturbation"], size=8.3, anchor="end")
        v0 = r["recall"]["repo"]
        v2 = r["recall"]["uf_relaxed"]
        w0 = max(v0 * (x1 - x0), 0)
        w2 = max(v2 * (x1 - x0), 0)
        s.add(f'<rect x="{x0}" y="{y + 2}" width="{w0:.1f}" height="7" fill="{C["verm"]}"/>')
        s.add(f'<rect x="{x0}" y="{y + 10}" width="{w2:.1f}" height="7" fill="{C["blue"]}"/>')
        s.text(x0 + w0 + 3, y + 8.6, f"{v0:.2f}", size=7.4, fill=C["verm"])
        s.text(x0 + w2 + 3, y + 16.6, f"{v2:.2f}", size=7.4, fill=C["blue"])
    yb = top + rh * len(rows) + 28
    s.add(f'<rect x="{x0 - 100}" y="{yb - 8}" width="9" height="8" fill="{C["verm"]}"/>')
    s.text(x0 - 87, yb - 1, "repository deduplicate()", size=8.4)
    s.add(f'<rect x="{x0 + 55}" y="{yb - 8}" width="9" height="8" fill="{C["blue"]}"/>')
    s.text(x0 + 68, yb - 1, "relaxed-key prototype", size=8.4)
    s.save(os.path.join(HERE, "fig_dedup.svg"))


def fig_ai():
    sp = load("e5_spacing.json")
    bo = load("e5_backoff.json")
    if not sp or not bo:
        return
    W, H = 740, 215
    s = SVG(W, H)
    # (a) spacing
    s.text(8, 11, "(a) Serial analysis loop: time per paper vs. model latency L (τ = 2 s)", size=9.2, weight="bold")
    ax = Axes(s, 58, 26, 280, 135, (0, 3300), (0, 4), xlabel="Injected model latency, L (s)", ylabel="Seconds per paper",
              xticks=[0, 1000, 2000, 3000], yticks=[0, 1, 2, 3, 4], xfmt=lambda v: f"{v / 1000:g}", yfmt=lambda v: f"{v:g}")
    Ls = [r["L"] for r in sp["rows"]]
    ax.polyline([0] + Ls + [3300], [2, ] + [max(L, 2000) / 1000 for L in Ls] + [3.3], C["blue"], dash="5 3", sw=1.4)
    # plot model as exact max(L,tau): piecewise
    meas = [r["perPaper_ms"] / 1000 for r in sp["rows"]]
    ax.polyline(Ls, meas, C["verm"], sw=1.6, marker="o", msize=3.2)
    legend(s, 70, 182, [("measured (N = 6 papers per point)", C["verm"], None, "o")], size=8.3)
    legend(s, 70 + 190, 182, [("model max(L, τ)", C["blue"], "5 3", None)], size=8.3)
    # (b) backoff
    s.text(392, 11, "(b) HTTP 429 handling: time until success / failure", size=9.2, weight="bold")
    ax2 = Axes(s, 448, 26, 280, 135, (0.5, 4.5), (0, 20), xlabel="Consecutive 429 responses before the first 200", ylabel="Elapsed (s)",
               xticks=[1, 2, 3, 4], yticks=[0, 5, 10, 15, 20], xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:g}")
    model = {1: 2.25, 2: 6.5, 3: 14.75, 4: 14.75}
    ax2.polyline(list(model), list(model.values()), C["blue"], dash="5 3", sw=1.4)
    for r in bo["rows"]:
        k = r["consecutive429"]
        ok = r["outcome"] == "ok"
        cx, cy = ax2.px(k + (r["rep"] - 1) * 0.12), ax2.py(r["total_ms"] / 1000)
        if ok:
            s.circle(cx, cy, 3.2, fill=C["verm"])
        else:
            s.circle(cx, cy, 3.2, fill="white", stroke=C["verm"], sw=1.5)
    s.text(ax2.px(4) , ax2.py(14.75) - 9, "4th 429 → error thrown", size=7.6, anchor="middle", fill=C["verm"])
    legend(s, 458, 182, [("measured, request succeeded (n = 3 per k)", C["verm"], None, "o")], size=8.3, line_len=0)
    legend(s, 458, 195, [("measured, error thrown", C["verm"], None, "o_open")], size=8.3, line_len=0)
    legend(s, 628, 182, [("model Σ(2^a + 0.25)", C["blue"], "5 3", None)], size=8.3, line_len=16)
    s.save(os.path.join(HERE, "fig_ai.svg"))


def fig_scaling():
    a = load("e2b_dedup_scaling.json")
    c = load("e4_c_library_scan.json")
    if not a or not c:
        return
    W, H = 740, 215
    s = SVG(W, H)
    s.text(8, 11, "(a) deduplicate(): wall-clock vs. input size n", size=9.2, weight="bold")
    ax = Axes(s, 62, 26, 270, 135, (80, 130000), (0.01, 1000), xscale="log", yscale="log", xlabel="Input records, n", ylabel="Time (ms)",
              xticks=[100, 1000, 10000, 100000], yticks=[0.01, 0.1, 1, 10, 100, 1000], xfmt=lambda v: f"{int(v):,}".replace(",", " "), yfmt=lambda v: f"{v:g}")
    ns = [r["n"] for r in a["rows"]]
    for key, col, mk, lab in [("repo", C["verm"], "o", "repository (first-match)"), ("uf_repo_keys", C["blue"], "s", "union-find, same keys"), ("uf_relaxed", C["green"], "^", "union-find, relaxed key")]:
        ax.polyline(ns, [r[key]["median"] for r in a["rows"]], col, sw=1.5, marker=mk, msize=3)
    legend(s, 70, 182, [("repository (first-match)", C["verm"], None, "o"), ("union-find, repository keys", C["blue"], None, "s")], size=8.2, gap=12)
    legend(s, 230, 182, [("union-find, relaxed key", C["green"], None, "^")], size=8.2, gap=12)
    s.text(392, 11, "(b) getLibraryPapers(): wall-clock vs. unmatched PDF files F", size=9.2, weight="bold")
    ymax = max(r["getLibraryPapers_ms"]["median"] for r in c["rows"])
    top = 50 if ymax <= 50 else (100 if ymax <= 100 else (250 if ymax <= 250 else (500 if ymax <= 500 else 1000)))
    ax2 = Axes(s, 448, 26, 275, 135, (0, 1050), (0, top), xlabel="PDF files in raw_papers/, F", ylabel="Time (ms)", xticks=[0, 250, 500, 750, 1000])
    cols = {1000: (C["blue"], "s"), 5000: (C["orange"], "^"), 20000: (C["verm"], "o")}
    for P, (col, mk) in cols.items():
        rr = [r for r in c["rows"] if r["dbRows"] == P]
        ax2.polyline([r["pdfFiles"] for r in rr], [r["getLibraryPapers_ms"]["median"] for r in rr], col, sw=1.5, marker=mk, msize=3)
    legend(s, 458, 182, [("P = 1 000 rows", C["blue"], None, "s"), ("P = 5 000 rows", C["orange"], None, "^")], size=8.2, gap=12)
    legend(s, 598, 182, [("P = 20 000 rows", C["verm"], None, "o")], size=8.2, gap=12)
    s.save(os.path.join(HERE, "fig_scaling.svg"))


if __name__ == "__main__":
    for f in (fig_latency, fig_dedup, fig_ai, fig_scaling):
        f()
    print("charts done")
