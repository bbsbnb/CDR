from __future__ import annotations

import json
import os
import re
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "source"
EXTRACTED_DIR = SOURCE_DIR / "extracted" / "construction-dispute-expert"
LEGACY_SKILLS_DIR = ROOT / "skills"
DEFAULT_ZIP = Path(
    r"C:\Users\Administrator\Documents\xwechat_files\lov_ll_75df\msg\file\2026-09\construction-dispute-expert.zip"
)


@dataclass(slots=True)
class Document:
    id: str
    library_type: str
    title: str
    topic: str
    summary: str
    body: str
    source_path: str
    version_status: str = ""
    owner: str = ""
    risk_flags: list[str] | None = None
    attachments: list[dict] | None = None

    def public(self, include_body: bool = False) -> dict:
        data = asdict(self)
        if not include_body:
            data.pop("body")
        data["risk_flags"] = data["risk_flags"] or []
        data["attachments"] = [
            {key: value for key, value in attachment.items() if key != "path"}
            for attachment in (data["attachments"] or [])
        ]
        return data


INSTITUTION_META = {
    1: ("讨论稿", "原文未载明"),
    2: ("转录件（随01号效力）", "原文未载明"),
    3: ("转录件（随01号效力）", "原文未载明"),
    4: ("讨论稿", "原文未载明"),
    5: ("转录件（随04号效力）", "原文未载明"),
    6: ("讨论稿", "原文未载明"),
    7: ("转录件（随06号效力）", "原文未载明"),
    8: ("修改版", "合同部"),
    9: ("转录件（随08号效力）", "合同部"),
    10: ("修改稿", "合同资料部"),
    11: ("修改版", "原文未载明"),
    12: ("拟定稿（2025年12月起试行）", "合同部、造价部、财务部"),
    13: ("2019版模板", "财务/造价/商务"),
    14: ("2019版模板", "财务/造价/商务"),
    15: ("2019版模板", "项目经理/预算"),
    16: ("2019版模板", "项目经理/财务/预算"),
    17: ("扣分制修改", "原文未载明"),
    18: ("扣分制修改稿", "原文未载明"),
    19: ("扣分制修改", "原文未载明"),
    20: ("扣分制修改稿", "原文未载明"),
    21: ("混版：2026-03-09修改版 / 2026-04-17修订正式版", "合同资料部"),
    22: ("未标版本", "行政综合办"),
    23: ("2026版（无发布日）", "综合办"),
}


def _safe_extract(zip_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for entry in archive.infolist():
            target = (destination / entry.filename).resolve()
            if root != target and root not in target.parents:
                raise ValueError(f"ZIP包含越界路径：{entry.filename}")
        archive.extractall(destination)


def ensure_source() -> Path:
    if EXTRACTED_DIR.exists():
        return EXTRACTED_DIR
    configured = Path(os.environ.get("DISPUTE_EXPERT_ZIP", str(DEFAULT_ZIP)))
    if configured.exists():
        _safe_extract(configured, SOURCE_DIR / "extracted")
        if EXTRACTED_DIR.exists():
            return EXTRACTED_DIR
    if LEGACY_SKILLS_DIR.exists():
        return ROOT
    raise FileNotFoundError("未找到专家包。请设置 DISPUTE_EXPERT_ZIP 指向原始 ZIP。")


def _skills_root() -> Path:
    source = ensure_source()
    return source / "skills"


def _clean_title(title: str) -> str:
    return re.sub(r"^\d{1,3}", "", title).replace("@王总", "").replace("@宋总", "").replace("@公司", "").replace("@建造合同", "").strip()


def _summary(body: str, empty_message: str = "") -> str:
    text = re.sub(r"\s+", " ", body).strip()
    if not text:
        return empty_message
    return text[:180] + ("…" if len(text) > 180 else "")


def _load_mapping(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_case_documents() -> list[Document]:
    base = _skills_root() / "construction-case-library" / "references"
    rows = _load_mapping(base / "_原文文件对照.json")
    documents = []
    for row in rows:
        case_id = int(row["编号"])
        body_path = base / "原文库" / row["原文文件"]
        body = body_path.read_text(encoding="utf-8-sig") if body_path.exists() else ""
        documents.append(
            Document(
                id=f"{case_id:03d}",
                library_type="case",
                title=_clean_title(row["标题"]),
                topic=re.sub(r"^\d+\s*", "", row["主题"]),
                summary=_summary(body, "原文为空，源资料未提供可读取正文。"),
                body=body,
                source_path=str(body_path.relative_to(_skills_root().parent)),
                risk_flags=["empty_source"] if not body.strip() else [],
            )
        )
    return sorted(documents, key=lambda item: int(item.id))


def _institution_attachments(base: Path, doc_id: int) -> list[dict]:
    result: list[dict] = []
    if doc_id in {2, 3, 5, 7, 9}:
        flow_dir = base / "原文库" / "流程图"
        for path in flow_dir.glob("*"):
            keywords = {2: "流程图1", 3: "流程图2", 5: "二次经营", 7: "三次经营", 9: "总包合同"}
            if keywords[doc_id] in path.name:
                result.append({"name": path.name, "kind": "流程图", "path": str(path)})
    if 13 <= doc_id <= 16:
        excel_dir = base / "原文库" / "_Excel完整导出"
        prefix = f"{doc_id:03d}-"
        for path in excel_dir.glob(f"{prefix}*"):
            result.append({"name": path.name, "kind": "Excel文本导出", "path": str(path)})
    return result


def load_institution_documents() -> list[Document]:
    base = _skills_root() / "tianxing-institution-library" / "references"
    rows = _load_mapping(base / "_原文文件对照.json")
    documents = []
    for row in rows:
        doc_id = int(row["编号"])
        body_path = base / "原文库" / row["原文文件"]
        body = body_path.read_text(encoding="utf-8-sig") if body_path.exists() else ""
        status, owner = INSTITUTION_META.get(doc_id, ("未标版本", "原文未载明"))
        flags = ["unverified_effectiveness"]
        if doc_id == 12:
            flags.append("trial_wording")
        if doc_id == 21:
            flags.extend(["mixed_versions", "highest_risk"])
        documents.append(
            Document(
                id=f"{doc_id:03d}",
                library_type="institution",
                title=_clean_title(row["标题"]),
                topic=re.sub(r"^\d+\s*", "", row["主题"]),
                summary=_summary(body),
                body=body,
                source_path=str(body_path.relative_to(_skills_root().parent)),
                version_status=status,
                owner=owner,
                risk_flags=flags,
                attachments=_institution_attachments(base, doc_id),
            )
        )
    return sorted(documents, key=lambda item: int(item.id))


class KnowledgeBase:
    def __init__(self) -> None:
        self.cases = load_case_documents()
        self.institutions = load_institution_documents()
        self.case_map = {item.id: item for item in self.cases}
        self.institution_map = {item.id: item for item in self.institutions}

    def attachment_path(self, doc_id: str, index: int) -> Path | None:
        document = self.institution_map.get(doc_id.zfill(3))
        attachments = document.attachments if document else []
        if index < 0 or index >= len(attachments or []):
            return None
        path = Path(attachments[index]["path"]).resolve()
        skills_root = _skills_root().resolve()
        if skills_root not in path.parents or not path.is_file():
            return None
        return path

    @property
    def topics(self) -> dict[str, list[str]]:
        return {
            "cases": sorted({item.topic for item in self.cases}),
            "institutions": sorted({item.topic for item in self.institutions}),
        }
