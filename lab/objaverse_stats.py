import gzip, json, glob, re, collections, os
META = os.path.expanduser("~/.objaverse/hf-objaverse-v1/metadata")
cat = collections.Counter(); catlic = collections.Counter(); tag = collections.Counter(); lic = collections.Counter(); n = 0
kw = {k: collections.Counter() for k in ("fabelwesen", "tiere", "pflanzen")}
RX = {"fabelwesen": re.compile(r"\b(dragon|unicorn|griffin|gryphon|phoenix|mermaid|centaur|fairy|elf|goblin|troll|orc|ogre|wyvern|pegasus|werewolf|vampire|demon|angel|monster|creature|kraken|minotaur|sphinx|golem|yeti|ghost|zombie|skeleton|wizard|witch|giant)s?\b", re.I),
      "tiere": re.compile(r"\b(cat|dog|horse|bird|fish|shark|whale|dolphin|bear|wolf|fox|rabbit|deer|cow|pig|sheep|goat|lion|tiger|elephant|monkey|snake|frog|turtle|owl|eagle|duck|chicken|butterfly|spider|insect|dinosaur|crab|lizard|mouse|rat|squirrel|giraffe|zebra|penguin|bee|ant|beetle|crocodile|octopus|rhino|hippo|gorilla|bat)s?\b", re.I),
      "pflanzen": re.compile(r"\b(plant|flower|tree|cactus|leaf|grass|bush|mushroom|fern|palm|rose|tulip|bamboo|vine|pine|oak|fruit|vegetable|bonsai|succulent|lily|orchid|sunflower)s?\b", re.I)}
for p in sorted(glob.glob(META + "/*.json.gz")):
    for uid, m in json.load(gzip.open(p)).items():
        n += 1; lic[m.get("license")] += 1
        cs = [c.get("name") for c in (m.get("categories") or [])]
        for c in cs: cat[c] += 1; catlic[(c, m.get("license"))] += 1
        ts = [t.get("name", "").lower() for t in (m.get("tags") or [])]
        for t in ts: tag[t] += 1
        txt = (m.get("name") or "") + " " + " ".join(ts)
        for k, rx in RX.items():
            for w in set(x.lower().rstrip("s") for x in rx.findall(txt)): kw[k][w] += 1
json.dump(dict(n=n, license=lic, categories=cat, top_tags=tag.most_common(400), kw={k: v.most_common() for k, v in kw.items()}, cat_lic={f"{a}|{b}": v for (a, b), v in catlic.items()}), open("stats.json", "w"), indent=1)
print(n, lic.most_common()); print(cat.most_common())
