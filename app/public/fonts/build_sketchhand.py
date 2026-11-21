"""Baut „SketchHand“: eine abgewandelte Caveat (SIL OFL 1.1) mit echter Handschrift-Variation.

Jeder Buchstabe/jede Ziffer bekommt zwei Alternativen (leicht gedreht, gestaucht/gestreckt,
Grundlinie versetzt, Konturen sanft verwackelt). Ein contextual-alternates-Lookup (calt) wechselt
beim Setzen reihum zwischen Original → Alt1 → Alt2, sodass gleiche Buchstaben nebeneinander
nie identisch aussehen.

Aufruf: python3 build_sketchhand.py <eingang.woff2> <ausgang.woff2> <gewichtsname>
"""
import math, random, sys, copy
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.basePen import BasePen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.otlLib.builder import buildCoverage  # noqa: F401 (nur zur Klarheit, nicht genutzt)

src, dst, weight = sys.argv[1], sys.argv[2], sys.argv[3]
font = TTFont(src)
cmap = font.getBestCmap()
gs = font.getGlyphSet()
glyf, hmtx = font['glyf'], font['hmtx']

CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüÄÖÜß0123456789'
names0 = set(font.getGlyphOrder())
bases = []
for ch in CHARS:
    g = cmap.get(ord(ch))
    if not g:
        continue
    # Caveat hat eigene Wechselformen (.ss01/.ss02) – die bekommen ebenfalls Hand-Varianten
    for v in (g, g + '.ss01', g + '.ss02'):
        if v in names0 and v not in bases:
            bases.append(v)


def warp_fn(seed, box):
    """Liefert eine Punkt-Transformation: Drehung, Skalierung, Schräge, Grundlinie + sanftes Wackeln."""
    r = random.Random(seed)
    xmin, ymin, xmax, ymax = box
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    ang = math.radians(r.choice([-1, 1]) * r.uniform(2.5, 6.5))
    sx, sy = r.uniform(0.9, 1.08), r.choice([r.uniform(0.86, 0.95), r.uniform(1.04, 1.12)])
    skew = r.uniform(-0.12, 0.1)
    dy = r.choice([-1, 1]) * r.uniform(12, 34)
    amp = r.uniform(9, 17)                      # Wackeln in Font-Einheiten (UPM 1000)
    f1, f2 = r.uniform(0.008, 0.016), r.uniform(0.012, 0.022)
    p1, p2 = r.uniform(0, 6.28), r.uniform(0, 6.28)
    ca, sa = math.cos(ang), math.sin(ang)

    def f(pt):
        x, y = pt[0] - cx, pt[1] - cy
        x, y = x * sx + y * skew, y * sy
        x, y = x * ca - y * sa, x * sa + y * ca
        x, y = x + cx, y + cy + dy
        # niederfrequentes Rauschen: Linien bleiben glatt, wirken aber nicht „konstruiert“
        x += amp * math.sin(y * f1 + p1) * 0.8
        y += amp * math.sin(x * f2 + p2) * 0.6
        return (round(x), round(y))
    return f, sx


class MapPen(BasePen):
    """Reicht Konturen an einen Ziel-Stift weiter und transformiert dabei jeden Punkt."""
    def __init__(self, out, fn):
        super().__init__(None)
        self.out, self.fn = out, fn
    def moveTo(self, p): self.out.moveTo(self.fn(p))
    def lineTo(self, p): self.out.lineTo(self.fn(p))
    def qCurveTo(self, *ps): self.out.qCurveTo(*[self.fn(p) if p is not None else None for p in ps])
    def curveTo(self, *ps): self.out.curveTo(*[self.fn(p) for p in ps])
    def closePath(self): self.out.closePath()
    def endPath(self): self.out.endPath()


order = font.getGlyphOrder()
new_names = {1: [], 2: []}
for b in bases:
    rec = DecomposingRecordingPen(gs)
    gs[b].draw(rec)
    g0 = glyf[b]
    g0.recalcBounds(glyf)
    box = (getattr(g0, 'xMin', 0), getattr(g0, 'yMin', 0), getattr(g0, 'xMax', 500), getattr(g0, 'yMax', 600))
    adv, _ = hmtx[b]
    for k in (1, 2):
        name = f'{b}.hw{k}'
        fn, sx = warp_fn(f'{b}-{k}-{weight}', box)
        tp = TTGlyphPen(None)
        rec.replay(MapPen(tp, fn))
        ng = tp.glyph()
        ng.recalcBounds(glyf)
        glyf[name] = ng
        hmtx[name] = (round(adv * (0.5 + 0.5 * sx)), getattr(ng, 'xMin', 0))
        new_names[k].append(name)
order = list(dict.fromkeys(glyf.glyphOrder))
font.setGlyphOrder(order)
glyf.glyphOrder = order
font['maxp'].numGlyphs = len(order)
font['post'].extraNames = []
font['post'].mapping = {}

# GDEF: neue Glyphen als Basisglyphen
cd = font['GDEF'].table.GlyphClassDef
if cd is not None:
    for k in (1, 2):
        for n in new_names[k]:
            cd.classDefs[n] = 1

# Lookups über einen Hilfs-Font bauen und an die bestehende GSUB anhängen (Caveats eigene calt bleiben erhalten)
fea = f"""
@B = [{' '.join(bases)}];
@A1 = [{' '.join(new_names[1])}];
@A2 = [{' '.join(new_names[2])}];
lookup toA1 {{ sub @B by @A1; }} toA1;
lookup toA2 {{ sub @B by @A2; }} toA2;
lookup cycle {{
  sub @A1 @B' lookup toA2;
  sub @A2 @B' lookup toA1;
  sub @B @B' lookup toA1;
}} cycle;
feature calt {{ lookup cycle; }} calt;
"""
tmp = copy.deepcopy(font)
del tmp['GSUB']
addOpenTypeFeaturesFromString(tmp, fea, tables=['GSUB'])
tl = tmp['GSUB'].table.LookupList.Lookup
gsub = font['GSUB'].table
base_idx = len(gsub.LookupList.Lookup)
# Reihenfolge im Hilfs-Font: toA1, toA2, cycle → Verweise im Kontext-Lookup verschieben
for lk in tl:
    for st in lk.SubTable:
        for attr in ('ChainSubClassSet', 'ChainSubRuleSet'):
            for rs in (getattr(st, attr, None) or []):
                if rs is None:
                    continue
                for rule in (getattr(rs, 'ChainSubClassRule', None) or getattr(rs, 'ChainSubRule', None) or []):
                    for rec in rule.SubstLookupRecord:
                        rec.LookupListIndex += base_idx
        for rec in (getattr(st, 'SubstLookupRecord', None) or []):
            rec.LookupListIndex += base_idx
    gsub.LookupList.Lookup.append(lk)
gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
cycle_idx = base_idx + 2
for fr in gsub.FeatureList.FeatureRecord:
    if fr.FeatureTag == 'calt':
        fr.Feature.LookupListIndex.append(cycle_idx)
        fr.Feature.LookupCount = len(fr.Feature.LookupListIndex)

# Eigener Name (abgewandelte Schrift unter eigenem Namen, Lizenzhinweis bleibt)
fam, full = 'SketchHand', f'SketchHand {weight}'
for n in font['name'].names:
    if n.nameID in (1, 16):
        n.string = fam
    elif n.nameID == 4:
        n.string = full
    elif n.nameID == 6:
        n.string = f'SketchHand-{weight}'
    elif n.nameID == 3:
        n.string = f'SketchHand-{weight}; modified from Caveat'
font['name'].setName('Modified by SketchToCAD (2026) from Caveat, SIL Open Font License 1.1', 5, 3, 1, 0x409)

font.flavor = 'woff2'
font.save(dst)
print(dst, 'Basisglyphen', len(bases), 'neu', len(new_names[1]) * 2)
