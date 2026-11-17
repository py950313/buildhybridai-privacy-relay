import json, re, collections
from pathlib import Path
H = Path(__file__).parent
gold = {d["id"]: d for d in map(json.loads, (H / "data/dev.jsonl").read_text(encoding="utf-8").splitlines())}
pred = {d["id"]: d for d in map(json.loads, (H / "out/engine_gliner_dev.jsonl").read_text(encoding="utf-8").splitlines())}
ov = lambda a, b: a["start"] < b["end"] and b["start"] < a["end"]
b = collections.defaultdict(lambda: collections.Counter())
for i, d in gold.items():
    for p in pred[i]["preds"]:
        m = re.match(r"gliner (.+) (\d\.\d+)$", p.get("reason") or "")
        if not m: continue
        if any(ov(p, g) for g in d["ignored"]) and not any(ov(p, g) for g in d["gold"]): continue
        ok = any(ov(p, g) for g in d["gold"])
        bucket = min(9, int(float(m.group(2)) * 10))
        b[m.group(1)][(bucket, ok)] += 1
for label, c in sorted(b.items(), key=lambda x: -sum(x[1].values())):
    row = " ".join(f"{k/10:.1f}:{c[(k, True)]}/{c[(k, False)]}" for k in range(3, 10))
    print(f"{label:28s} TP/FP by score  {row}")
