"""Minimal SVG helpers (no third-party dependencies). Figures are generated from code so they can be
regenerated from the measured JSON in ../results. Canvas widths follow the IEEE column grid:
single column = 360 px (~3.5 in), double column = 740 px (~7.2 in); text sizes are chosen so that
the printed size is >= 6.5 pt."""
import html

FONT = "Liberation Sans, Arial, Helvetica, sans-serif"
MONO = "Liberation Mono, Courier New, monospace"
INK = "#1a1a1a"
GRID = "#d9d9d9"
MUTED = "#555555"
# Okabe-Ito colour-blind-safe palette
C = dict(blue="#0072B2", orange="#E69F00", green="#009E73", verm="#D55E00", purple="#CC79A7", sky="#56B4E9", yellow="#F0E442", grey="#999999")
FILL = dict(blue="#dcebf5", orange="#fbeccb", green="#d4efe6", verm="#f6dccd", purple="#f1dde8", grey="#ececec", white="#ffffff")


def esc(s):
    return html.escape(str(s), quote=False)


class SVG:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.parts = []
        self.defs = (
            '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker>'
            '<marker id="arrg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker>'
        )

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill="white", stroke=INK, sw=1, rx=3, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def text(self, x, y, s, size=10, anchor="start", weight="normal", fill=INK, family=FONT, style="normal", rot=None):
        tr = f' transform="rotate({rot} {x} {y})"' if rot is not None else ""
        self.add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" font-style="{style}" fill="{fill}"{tr}>{esc(s)}</text>')

    def lines(self, x, y, ls, size=10, anchor="start", lh=None, **kw):
        lh = lh or size * 1.22
        for i, l in enumerate(ls):
            self.text(x, y + i * lh, l, size=size, anchor=anchor, **kw)

    def box(self, x, y, w, h, title, sub=(), fill="white", stroke=INK, tsize=10.5, ssize=9, rx=3, dash=None, tcolor=INK, mono=False):
        self.rect(x, y, w, h, fill=fill, stroke=stroke, rx=rx, dash=dash)
        n = len(sub)
        total = tsize * 1.2 + n * ssize * 1.22
        y0 = y + (h - total) / 2 + tsize
        self.text(x + w / 2, y0, title, size=tsize, anchor="middle", weight="bold", fill=tcolor)
        for i, s in enumerate(sub):
            self.text(x + w / 2, y0 + tsize * 0.2 + (i + 1) * ssize * 1.22, s, size=ssize, anchor="middle", fill=MUTED if not mono else INK, family=MONO if mono else FONT)

    def line(self, x1, y1, x2, y2, stroke=INK, sw=1, dash=None, arrow=False, grey=False):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = ""
        if arrow:
            m = ' marker-end="url(#arrg)"' if grey else ' marker-end="url(#arr)"'
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"{d}{m}/>')

    def path(self, d, stroke=INK, sw=1, fill="none", dash=None, arrow=False, grey=False):
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        m = ""
        if arrow:
            m = ' marker-end="url(#arrg)"' if grey else ' marker-end="url(#arr)"'
        self.add(f'<path d="{d}" stroke="{stroke}" stroke-width="{sw}" fill="{fill}"{dd}{m}/>')

    def circle(self, x, y, r, fill=INK, stroke="none", sw=1):
        self.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def save(self, path):
        body = "\n".join(self.parts)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">\n'
               f'<defs>{self.defs}</defs>\n<rect width="{self.w}" height="{self.h}" fill="white"/>\n{body}\n</svg>\n')
        open(path, "w", encoding="utf-8").write(svg)


# ------------------------------------------------------------------ charts
def nice_ticks(lo, hi, n=5):
    import math
    if hi == lo:
        hi = lo + 1
    raw = (hi - lo) / n
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        step = m * mag
        if step >= raw:
            break
    t0 = math.floor(lo / step) * step
    ticks = []
    v = t0
    while v <= hi + step * 0.5:
        ticks.append(round(v, 10))
        v += step
    return ticks


class Axes:
    """Cartesian axes drawn into an SVG. xscale/yscale: 'lin' or 'log'."""

    def __init__(self, svg, x, y, w, h, xlim, ylim, xscale="lin", yscale="lin", xlabel="", ylabel="", xticks=None, yticks=None,
                 xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:g}", size=9.6):
        self.s, self.x, self.y, self.w, self.h = svg, x, y, w, h
        self.xlim, self.ylim, self.xs, self.ys = xlim, ylim, xscale, yscale
        self.size = size
        import math
        self.m = math
        s = svg
        xt = xticks if xticks is not None else nice_ticks(*xlim)
        yt = yticks if yticks is not None else nice_ticks(*ylim)
        for v in yt:
            py = self.py(v)
            if y - 0.5 <= py <= y + h + 0.5:
                s.line(x, py, x + w, py, stroke=GRID, sw=0.6)
                s.text(x - 4, py + size * 0.35, yfmt(v), size=size, anchor="end", fill=MUTED)
        for v in xt:
            px = self.px(v)
            if x - 0.5 <= px <= x + w + 0.5:
                s.line(px, y + h, px, y + h + 3, stroke=INK, sw=0.8)
                s.text(px, y + h + 3 + size + 1, xfmt(v), size=size, anchor="middle", fill=MUTED)
        s.line(x, y + h, x + w, y + h, sw=1)
        s.line(x, y, x, y + h, sw=1)
        if xlabel:
            s.text(x + w / 2, y + h + 3 + 2 * size + 6, xlabel, size=size + 0.5, anchor="middle")
        if ylabel:
            s.text(x - 34, y + h / 2, ylabel, size=size + 0.5, anchor="middle", rot=-90)

    def _t(self, v, lim, scale):
        lo, hi = lim
        if scale == "log":
            return (self.m.log10(v) - self.m.log10(lo)) / (self.m.log10(hi) - self.m.log10(lo))
        return (v - lo) / (hi - lo)

    def px(self, v):
        return self.x + self._t(v, self.xlim, self.xs) * self.w

    def py(self, v):
        return self.y + self.h - self._t(v, self.ylim, self.ys) * self.h

    def polyline(self, xs, ys, color, sw=1.6, dash=None, marker=None, msize=3):
        pts = " ".join(f"{self.px(a):.1f},{self.py(b):.1f}" for a, b in zip(xs, ys))
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.s.add(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{sw}"{d} stroke-linejoin="round"/>')
        if marker:
            for a, b in zip(xs, ys):
                cx, cy = self.px(a), self.py(b)
                if marker == "o":
                    self.s.circle(cx, cy, msize, fill=color)
                elif marker == "s":
                    self.s.add(f'<rect x="{cx - msize:.1f}" y="{cy - msize:.1f}" width="{2 * msize}" height="{2 * msize}" fill="{color}"/>')
                elif marker == "^":
                    self.s.add(f'<path d="M{cx:.1f},{cy - msize - 0.5:.1f} L{cx + msize + 0.5:.1f},{cy + msize:.1f} L{cx - msize - 0.5:.1f},{cy + msize:.1f} z" fill="{color}"/>')
                elif marker == "d":
                    self.s.add(f'<path d="M{cx:.1f},{cy - msize - 1:.1f} L{cx + msize + 1:.1f},{cy:.1f} L{cx:.1f},{cy + msize + 1:.1f} L{cx - msize - 1:.1f},{cy:.1f} z" fill="{color}"/>')
                elif marker == "o_open":
                    self.s.circle(cx, cy, msize, fill="white", stroke=color, sw=1.4)

    def errbars(self, xs, lo, hi, color, cap=3):
        for a, l, h in zip(xs, lo, hi):
            cx = self.px(a)
            self.s.line(cx, self.py(l), cx, self.py(h), stroke=color, sw=1)
            self.s.line(cx - cap, self.py(l), cx + cap, self.py(l), stroke=color, sw=1)
            self.s.line(cx - cap, self.py(h), cx + cap, self.py(h), stroke=color, sw=1)


def legend(svg, x, y, items, size=9, gap=14, line_len=18):
    """items: list of (label, color, dash, marker)."""
    for i, (lab, col, dash, mk) in enumerate(items):
        yy = y + i * gap
        d = f' stroke-dasharray="{dash}"' if dash else ""
        svg.add(f'<line x1="{x}" y1="{yy}" x2="{x + line_len}" y2="{yy}" stroke="{col}" stroke-width="1.8"{d}/>')
        if mk == "o":
            svg.circle(x + line_len / 2, yy, 3, fill=col)
        elif mk == "s":
            svg.add(f'<rect x="{x + line_len / 2 - 3}" y="{yy - 3}" width="6" height="6" fill="{col}"/>')
        elif mk == "^":
            svg.add(f'<path d="M{x + line_len / 2},{yy - 3.5} L{x + line_len / 2 + 3.5},{yy + 3} L{x + line_len / 2 - 3.5},{yy + 3} z" fill="{col}"/>')
        elif mk == "d":
            svg.add(f'<path d="M{x + line_len / 2},{yy - 4} L{x + line_len / 2 + 4},{yy} L{x + line_len / 2},{yy + 4} L{x + line_len / 2 - 4},{yy} z" fill="{col}"/>')
        elif mk == "o_open":
            svg.circle(x + line_len / 2, yy, 3, fill="white", stroke=col, sw=1.4)
        svg.text(x + line_len + 5, yy + size * 0.35, lab, size=size)
