from __future__ import annotations

import re
import unicodedata

from .data_loader import Document


SYNONYMS = {
    "验收": ["验工", "计量", "报验"],
    "结算": ["审计", "审减", "送审", "对账"],
    "签证": ["变更", "签认", "认价"],
    "扣分": ["处罚", "考核", "绩效"],
    "归档": ["存档", "档案", "移交"],
    "工期": ["延误", "顺延", "停工", "赶工"],
    "分包": ["劳务", "实际施工人", "包工头"],
    "材料": ["甲供材", "认价", "价差", "超耗"],
}


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKC", text or "").lower()
    return re.sub(r"[\s\-_/，。；：、（）()【】\[\]]+", "", value)


def query_terms(query: str) -> tuple[list[str], list[str]]:
    raw = [part for part in re.split(r"\s+", query.strip()) if part]
    core = [normalize(part) for part in raw]
    expanded: list[str] = []
    for part in raw:
        for key, values in SYNONYMS.items():
            if key in part or part in key:
                expanded.extend(normalize(item) for item in values)
    return core, list(dict.fromkeys(expanded))


def score_document(document: Document, query: str) -> float:
    if not query.strip():
        return 1.0
    phrase = normalize(query)
    core, expanded = query_terms(query)
    title = normalize(document.title)
    summary = normalize(document.summary)
    body = normalize(document.body)
    doc_id = normalize(document.id)
    score = 0.0
    matched_core = 0
    if phrase and phrase == title:
        score += 10
    elif phrase and phrase in title:
        score += 5
    for term in core:
        hit = False
        if term in title or term == doc_id:
            score += 5
            hit = True
        if term in summary:
            score += 3
            hit = True
        if term in body:
            score += 1
            hit = True
        matched_core += int(hit)
    if core and matched_core == 0:
        for term in expanded:
            if term in title or term in summary or term in body:
                score += 2
    return score


def search_documents(documents: list[Document], query: str = "", topic: str = "", limit: int = 100) -> list[dict]:
    ranked = []
    for document in documents:
        if topic and document.topic != topic:
            continue
        score = score_document(document, query)
        if query.strip() and score < 1:
            continue
        ranked.append((score, document))
    ranked.sort(key=lambda item: (-item[0], int(item[1].id)))
    results = []
    for score, document in ranked[:limit]:
        item = document.public()
        item["score"] = score
        results.append(item)
    return results
