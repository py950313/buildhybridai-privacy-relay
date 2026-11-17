"""Builds the evaluation inputs: data/en.jsonl (Nemotron-PII test sample) and data/zh.jsonl.

Gold spans are grouped into families shared by both systems. Labels outside the families are kept
as `ignored`: they are not counted as misses, and a prediction that only touches an ignored span
is not counted as a false positive (for either system).
"""
import ast
import json
import re
import sys
from pathlib import Path

import pandas as pd
from huggingface_hub import hf_hub_download

N_EN = next((int(a) for a in sys.argv[1:] if a.isdigit()), 300)
SEED = 20261117
HERE = Path(__file__).parent

FAMILY = {
    "first_name": "PERSON", "last_name": "PERSON",
    "company_name": "ORG",
    "street_address": "LOCATION", "city": "LOCATION", "state": "LOCATION", "county": "LOCATION",
    "country": "LOCATION", "postcode": "LOCATION",
    "email": "EMAIL",
    "phone_number": "PHONE", "fax_number": "PHONE",
    "ssn": "ID_NUMBER", "national_id": "ID_NUMBER", "tax_id": "ID_NUMBER", "medical_record_number": "ID_NUMBER",
    "health_plan_beneficiary_number": "ID_NUMBER", "certificate_license_number": "ID_NUMBER",
    "credit_debit_card": "CARD",
    "account_number": "ACCOUNT", "bank_routing_number": "ACCOUNT", "swift_bic": "ACCOUNT",
    "date_of_birth": "DOB",
}
ZH_FAMILY = {"ADDRESS": "LOCATION", "DATE_OF_BIRTH": "DOB"}


def merge_adjacent(spans, text):
    """first_name + last_name (or city, state) written together become one gold span."""
    out = []
    for s in sorted(spans, key=lambda x: x["start"]):
        if out and out[-1]["family"] == s["family"] and re.fullmatch(r"[\s,]{0,2}", text[out[-1]["end"]:s["start"]]):
            out[-1] = {**out[-1], "end": s["end"], "label": out[-1]["label"] + "+" + s["label"]}
        else:
            out.append(dict(s))
    return out


def en(split="test", name="en", seed=SEED):
    """`en` = held-out test sample used in the report; `dev` = train-split sample used for tuning."""
    p = hf_hub_download("nvidia/Nemotron-PII", f"data/{split}-00000-of-00001.parquet", repo_type="dataset",
                        local_dir=HERE / "data/nemotron")
    df = pd.read_parquet(p).sample(N_EN, random_state=seed)
    with open(HERE / f"data/{name}.jsonl", "w", encoding="utf-8") as f:
        for _, r in df.iterrows():
            gold, ignored = [], []
            for s in ast.literal_eval(r["spans"]):
                item = {"start": s["start"], "end": s["end"], "label": s["label"]}
                if s["label"] in FAMILY:
                    gold.append({**item, "family": FAMILY[s["label"]]})
                else:
                    ignored.append(item)
            row = {"id": r["uid"], "text": r["text"], "gold": merge_adjacent(gold, r["text"]), "ignored": ignored}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(name, "docs", len(df))


def zh():
    data = json.loads((HERE / "zh_samples.json").read_text(encoding="utf-8"))["samples"]
    n = 0
    with open(HERE / "data/zh.jsonl", "w", encoding="utf-8") as f:
        for s in data:
            gold = []
            for text, typ in s["entities"]:
                starts = [m.start() for m in re.finditer(re.escape(text), s["text"])]
                assert starts, (s["id"], text)
                for st in starts:
                    gold.append({"start": st, "end": st + len(text), "label": typ, "family": ZH_FAMILY.get(typ, typ)})
            n += len(gold)
            row = {"id": s["id"], "text": s["text"], "gold": sorted(gold, key=lambda x: x["start"]), "ignored": []}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("zh docs", len(data), "gold spans", n)


if "--dev" in sys.argv:
    en("train", "dev", SEED + 1)
else:
    en()
    zh()
