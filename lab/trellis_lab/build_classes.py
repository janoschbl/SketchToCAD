"""Tier-Klassen aus den Objaverse-LVIS-Annotationen (lvis-annotations.json.gz, allenai/objaverse) per WordNet
(Hypernym animal.n.01) plus Handkorrektur. Ergebnis: classes.json für die Testseite.
  ../.venv/bin/python build_classes.py
"""
import gzip, json, re
from nltk.corpus import wordnet as wn

ANIMAL = wn.synset("animal.n.01")
ADD = {"turtle", "tiger", "alligator", "duckling", "cock", "horned_cow", "ostrich", "heron", "gull", "eel", "pug-dog",
       "dalmatian", "crawfish", "prawn", "mouse_(animal)", "turkey_(bird)", "pony", "lion"}
DROP = {"drone"}  # WordNet: männliche Biene, in Objaverse aber Quadrokopter
# Fabelwesen: keine LVIS-Klasse, Treffer = Stichwort in Name/Tags (Zählung docs/objaverse-kategorien.md)
FANTASY = {"dragon": 2536, "unicorn": 159, "phoenix": 133, "griffin": 70, "pegasus": 54, "mermaid": 103, "centaur": 46,
           "werewolf": 84, "kraken": 48, "wyvern": 49, "yeti": 44, "gargoyle": 86}


def is_animal(name):
    if "food" in name:
        return False
    hint = "(animal)" in name or "(fish)" in name or "(bird)" in name
    base = re.sub(r"\s*\(.*\)", "", name).replace(" ", "_")
    ss = wn.synsets(base, pos="n")
    if hint or not ss:
        return hint
    return ANIMAL in set(ss[0].closure(lambda x: x.hypernyms()))


d = json.load(gzip.open("lvis-annotations.json.gz"))
out = [dict(name=k, label=re.sub(r"_", " ", k), count=len(v), group="LVIS")
       for k, v in d.items() if (is_animal(k) or k in ADD) and k not in DROP]
out.sort(key=lambda c: -c["count"])
out += [dict(name=k, label=k, count=n, group="Fabelwesen") for k, n in sorted(FANTASY.items(), key=lambda x: -x[1])]
json.dump(out, open("classes.json", "w"), indent=0)
print(len(out), "Klassen;", "fehlend aus ADD:", sorted(ADD - set(d)))
