"""Stufe 0: GObjaverse-Objekte auswählen (Lizenz, Kategorie, Qualität, Split) und einen Pilot ziehen.

Eingaben (siehe docs/pipeline-gobjaverse-trellis.md, Abschnitt 3):
  gobj/meta/gobjaverse_280k*.json, category_annotation.json, text_captions_cap3d.json
  ~/.objaverse/hf-objaverse-v1/metadata/*.json.gz  (Lizenz, Autor, Tags)

Ausgaben:
  gobj/select.jsonl   alle Treffer (gobj_id, uid, kategorie, lizenz, autor, split, caption, ...)
  gobj/pilot.json     Liste von gobj_ids für den Pilot (Standard 100: 40 % Tiere, 30 % Pflanzen, 30 % Kreaturen)

  python gobj/select.py [--pilot 100]
"""
import argparse, collections, gzip, json, os, re, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.join(HERE, "meta")
OBJA_META = os.path.expanduser("~/.objaverse/hf-objaverse-v1/metadata")

LICENSES = {"cc0", "by", "by-sa"}
BAD = re.compile(r"scan|photogrammetry|lidar|reality ?capture|polycam|metashape|agisoft|3d ?zephyr|kiri|point ?cloud|heightmap|terrain|landscape|nsfw", re.I)
CREATURE = re.compile(r"\b(creature|monster|dragon|demon|goblin|orc|troll|ogre|golem|fairy|elf|unicorn|phoenix|griffin|gryphon|pegasus|wyvern|kraken|centaur|minotaur|sphinx|mermaid|werewolf|yeti|gargoyle|imp|beast|alien|dino(saur)?|t-?rex|raptor|slime)s?\b", re.I)
CATS = ["Animals", "Plants", "Human-Shape"]


def split_of(uid):
    h = zlib.crc32(uid.encode()) % 100
    return "train" if h < 90 else ("val" if h < 95 else "test")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", type=int, default=100)
    a = ap.parse_args()

    idx2obj = json.load(open(f"{META}/gobjaverse_280k_index_to_objaverse.json"))
    caps = json.load(open(f"{META}/text_captions_cap3d.json"))
    poor = set(json.load(open(f"{META}/gobjaverse_280k_Poor-quality.json")))
    cat_of = collections.defaultdict(list)
    for c in CATS:
        for g in json.load(open(f"{META}/gobjaverse_280k_{c}.json")):
            cat_of[g].append(c)

    # nur Kandidaten der Zielkategorien, gruppiert nach Objaverse-Metadatei
    by_shard = collections.defaultdict(list)
    for g, cs in cat_of.items():
        if g in poor or g not in idx2obj:
            continue
        shard, glb = idx2obj[g].split("/")
        by_shard[shard].append((g, glb[:-4], cs))

    stats = collections.Counter()
    rows = []
    for shard in sorted(by_shard):
        p = f"{OBJA_META}/{shard}.json.gz"
        if not os.path.exists(p):
            stats["keine_metadaten"] += len(by_shard[shard]); continue
        d = json.load(gzip.open(p))
        for g, uid, cs in by_shard[shard]:
            m = d.get(uid)
            if m is None:
                stats["uid_fehlt"] += 1; continue
            if m.get("license") not in LICENSES:
                stats["lizenz"] += 1; continue
            if m.get("isAgeRestricted") or (m.get("animationCount") or 0) > 0:
                stats["alter/animation"] += 1; continue
            tags = " ".join(t.get("name", "") for t in (m.get("tags") or []))
            text = f"{m.get('name', '')} {tags} {(m.get('description') or '')[:300]}"
            if BAD.search(text):
                stats["scan"] += 1; continue
            cap = caps.get(g, "")
            # Kreatur: Human-Shape/Animals mit Fabelwesen-Stichwort in Name/Tags/Caption
            creature = bool(CREATURE.search(f"{m.get('name', '')} {tags} {cap}"))
            group = "creature" if creature and ("Human-Shape" in cs or "Animals" in cs) else \
                    ("animal" if "Animals" in cs else ("plant" if "Plants" in cs else "human"))
            rows.append(dict(gobj_id=g, uid=uid, shard=shard, categories=cs, group=group,
                             license=m.get("license"), author=(m.get("user") or {}).get("username"),
                             name=m.get("name"), url=m.get("viewerUrl"), caption=cap, split=split_of(uid)))
            stats["ok_" + group] += 1

    with open(f"{HERE}/select.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Pilot: deterministisch per Hash, nur aus test-fernen Objekten egal – Pilot dient dem Formatcheck
    quota = {"animal": round(a.pilot * .4), "plant": round(a.pilot * .3)}
    quota["creature"] = a.pilot - sum(quota.values())
    pilot = []
    for grp, n in quota.items():
        cand = sorted((r for r in rows if r["group"] == grp), key=lambda r: zlib.crc32(r["uid"].encode()))
        pilot += [r["gobj_id"] for r in cand[:n]]
    json.dump(pilot, open(f"{HERE}/pilot.json", "w"))

    print(json.dumps(dict(stats), indent=1))
    print("gesamt", len(rows), "| splits", collections.Counter(r["split"] for r in rows),
          "| lizenzen", collections.Counter(r["license"] for r in rows), "| pilot", len(pilot))


if __name__ == "__main__":
    main()
