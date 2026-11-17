"""Baseline: Microsoft Presidio with its predefined recognizers and spaCy large models for en and
zh. Two settings favour the baseline: ORGANIZATION is enabled (off by default) and Taiwan is added
to the phone regions."""
import json
import sys
from pathlib import Path

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import PhoneRecognizer

HERE = Path(__file__).parent
FAMILY = {
    "PERSON": "PERSON", "ORGANIZATION": "ORG", "LOCATION": "LOCATION", "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE", "CREDIT_CARD": "CARD", "IBAN_CODE": "ACCOUNT", "US_BANK_NUMBER": "ACCOUNT",
    "DATE_TIME": "DATE",
    "US_SSN": "ID_NUMBER", "US_ITIN": "ID_NUMBER", "US_PASSPORT": "ID_NUMBER", "US_DRIVER_LICENSE": "ID_NUMBER",
    "UK_NHS": "ID_NUMBER", "UK_NINO": "ID_NUMBER", "MEDICAL_LICENSE": "ID_NUMBER", "US_MBI": "ID_NUMBER",
    "US_NPI": "ID_NUMBER",
}
LANGS = ["en", "zh"]

nlp = NlpEngineProvider(nlp_configuration={
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}, {"lang_code": "zh", "model_name": "zh_core_web_lg"}],
    "ner_model_configuration": {
        "labels_to_ignore": ["CARDINAL", "EVENT", "LANGUAGE", "LAW", "MONEY", "ORDINAL", "PERCENT", "PRODUCT",
                             "QUANTITY", "WORK_OF_ART"],
        "model_to_presidio_entity_mapping": {
            "PER": "PERSON", "PERSON": "PERSON", "NORP": "NRP", "FAC": "LOCATION", "LOC": "LOCATION",
            "GPE": "LOCATION", "LOCATION": "LOCATION", "ORG": "ORGANIZATION", "ORGANIZATION": "ORGANIZATION",
            "DATE": "DATE_TIME", "TIME": "DATE_TIME",
        },
        "low_confidence_score_multiplier": 0.4,
        "low_score_entity_names": [],
    },
}).create_engine()
registry = RecognizerRegistry(supported_languages=LANGS)
registry.load_predefined_recognizers(languages=LANGS, nlp_engine=nlp)
REGIONS = ("US", "GB", "DE", "IL", "IN", "CA", "BR", "TW")
for lang in LANGS:
    registry.add_recognizer(PhoneRecognizer(supported_regions=REGIONS, supported_language=lang))
analyzer = AnalyzerEngine(nlp_engine=nlp, registry=registry, supported_languages=LANGS)

for lang in sys.argv[1:] or LANGS:
    n = 0
    with open(HERE / f"data/{lang}.jsonl", encoding="utf-8") as f, \
            open(HERE / f"out/presidio_{lang}.jsonl", "w", encoding="utf-8") as out:
        for line in f:
            d = json.loads(line)
            res = analyzer.analyze(text=d["text"], language="zh" if lang.startswith("zh") else lang)
            preds = [{"start": r.start, "end": r.end, "family": FAMILY.get(r.entity_type, "OTHER"),
                      "type": r.entity_type, "score": round(r.score, 2)} for r in res]
            out.write(json.dumps({"id": d["id"], "preds": preds}, ensure_ascii=False) + "\n")
            n += 1
    print(lang, "docs", n)
