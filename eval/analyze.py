"""Error analysis on the dev sample (never on the test sample): misses by label, false positives by type."""
import json, sys, collections
from pathlib import Path
HERE = Path(__file__).parent
name = sys.argv[1] if len(sys.argv) > 1 else "dev"
key = sys.argv[2] if len(sys.argv) > 2 else "engine_gliner"
gold = {d["id"]: d for d in map(json.loads, (HERE / f"data/{name}.jsonl").read_text(encoding="utf-8").splitlines())}
pred = {d["id"]: d for d in map(json.loads, (HERE / f"out/{key}_{name}.jsonl").read_text(encoding="utf-8").splitlines())}
ov = lambda a, b: a["start"] < b["end"] and b["start"] < a["end"]
miss = collections.defaultdict(list); tot = collections.Counter(); fp = collections.defaultdict(list); npred = 0; ok = 0
for i, d in gold.items():
    t = d["text"]; ps = pred[i]["preds"]
    for g in d["gold"]:
        tot[g["label"]] += 1
        if not any(ov(p, g) for p in ps): miss[g["label"]].append(t[max(0, g["start"] - 25):g["start"]] + "[[" + t[g["start"]:g["end"]] + "]]" + t[g["end"]:g["end"] + 10])
    for p in ps:
        og = any(ov(p, g) for g in d["gold"]); oi = [g["label"] for g in d["ignored"] if ov(p, g)]
        if og: npred += 1; ok += 1
        elif oi: fp["(ignored) " + p["type"] + " on " + oi[0]].append(t[p["start"]:p["end"]])
        else: npred += 1; fp[p["type"] + "/" + p.get("source", "")].append(t[p["start"]:p["end"]])
print("precision", round(ok / npred, 3), "preds", npred)
print("== misses by label (missed/total)")
for l, m in sorted(miss.items(), key=lambda x: -len(x[1])):
    print(f"{l}: {len(m)}/{tot[l]}"); [print("    ", x.replace("\n", " ")) for x in m[:5]]
print("== false positives by type/source")
for l, m in sorted(fp.items(), key=lambda x: -len(x[1])):
    if l.startswith("(ignored)"): continue
    print(f"{l}: {len(m)}  e.g. {[x[:40] for x in m[:10]]}")
print("== predictions that only touch ignored labels (not counted)")
for l, m in sorted(fp.items(), key=lambda x: -len(x[1]))[:40]:
    if l.startswith("(ignored)"): print(f"{l}: {len(m)}")
