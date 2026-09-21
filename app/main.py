from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr

from .data_loader import KnowledgeBase
from .database import add_citation, create_matter, delete_matter, get_matter, init_db, list_matters, update_matter
from .exporter import build_markdown
from .search import search_documents
from .ai_service import AIServiceError, analyze as analyze_ai, clear_runtime_config, public_status, set_runtime_config, test_connection


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "static"

app = FastAPI(title="工程纠纷处理专家", version="1.0.0", docs_url="/api/docs")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
kb: KnowledgeBase | None = None


class MatterPayload(BaseModel):
    title: str = "未命名纠纷"
    project_name: str = ""
    stance: str = ""
    counterparty: str = ""
    stage: str = ""
    dispute_type: str = ""
    amount: str = ""
    current_step: int = Field(default=1, ge=1, le=9)
    sections: dict = Field(default_factory=dict)


class CitationPayload(BaseModel):
    library_type: str
    doc_id: str
    title: str
    source_label: str


class ExportPayload(BaseModel):
    audience: str = "internal"


class AIAnalyzePayload(BaseModel):
    matter_id: str
    task: str = "risk_summary"
    selected_citations: list[str] = Field(default_factory=list, max_length=50)
    user_instruction: str = Field(default="", max_length=1200)


class AIConfigPayload(BaseModel):
    api_key: SecretStr
    model: str = "gpt-6-astra"
    base_url: str = "https://api.openai.com/v1/responses"
    protocol: str = "responses"
    provider: str = "OpenAI"


@app.on_event("startup")
def startup() -> None:
    global kb
    init_db()
    kb = KnowledgeBase()


def knowledge() -> KnowledgeBase:
    if kb is None:
        raise HTTPException(503, "知识库尚未加载")
    return kb


@app.get("/api/meta")
def meta() -> dict:
    store = knowledge()
    return {
        "case_count": len(store.cases),
        "readable_case_count": sum(bool(item.body.strip()) for item in store.cases),
        "institution_count": len(store.institutions),
        "topics": store.topics,
        "ai_enabled": public_status()["enabled"],
    }


@app.get("/api/cases")
def cases(q: str = "", topic: str = "", limit: int = Query(100, ge=1, le=185)) -> dict:
    store = knowledge()
    return {"items": search_documents(store.cases, q, topic, limit), "total": len(store.cases)}


@app.get("/api/cases/{case_id}")
def case_detail(case_id: str) -> dict:
    store = knowledge()
    item = store.case_map.get(case_id.zfill(3))
    if not item:
        raise HTTPException(404, "案例不存在")
    related = [doc.public() for doc in store.cases if doc.topic == item.topic and doc.id != item.id][:4]
    return {**item.public(include_body=True), "related": related}


@app.get("/api/institutions")
def institutions(q: str = "", topic: str = "", limit: int = Query(100, ge=1, le=100)) -> dict:
    store = knowledge()
    return {"items": search_documents(store.institutions, q, topic, limit), "total": len(store.institutions)}


@app.get("/api/institutions/{doc_id}")
def institution_detail(doc_id: str) -> dict:
    store = knowledge()
    item = store.institution_map.get(doc_id.zfill(3))
    if not item:
        raise HTTPException(404, "制度不存在")
    return item.public(include_body=True)


@app.get("/api/institutions/{doc_id}/attachments/{index}")
def institution_attachment(doc_id: str, index: int):
    path = knowledge().attachment_path(doc_id, index)
    if not path:
        raise HTTPException(404, "附件不存在")
    return FileResponse(path, filename=path.name)


@app.get("/api/search")
def unified_search(q: str) -> dict:
    store = knowledge()
    return {
        "cases": search_documents(store.cases, q, limit=8),
        "institutions": search_documents(store.institutions, q, limit=8),
    }


@app.get("/api/matters")
def matters() -> list[dict]:
    return list_matters()


@app.post("/api/matters", status_code=201)
def matter_create(payload: MatterPayload) -> dict:
    return create_matter(payload.model_dump())


@app.get("/api/matters/{matter_id}")
def matter_get(matter_id: str) -> dict:
    matter = get_matter(matter_id)
    if not matter:
        raise HTTPException(404, "案件不存在")
    return matter


@app.put("/api/matters/{matter_id}")
def matter_update(matter_id: str, payload: MatterPayload) -> dict:
    matter = update_matter(matter_id, payload.model_dump())
    if not matter:
        raise HTTPException(404, "案件不存在")
    return matter


@app.delete("/api/matters/{matter_id}", status_code=204)
def matter_delete(matter_id: str):
    if not delete_matter(matter_id):
        raise HTTPException(404, "案件不存在")


@app.post("/api/matters/{matter_id}/citations")
def citation_add(matter_id: str, payload: CitationPayload) -> dict:
    matter = add_citation(matter_id, payload.model_dump())
    if not matter:
        raise HTTPException(404, "案件不存在")
    return matter


@app.post("/api/matters/{matter_id}/export")
def matter_export(matter_id: str, payload: ExportPayload):
    matter = get_matter(matter_id)
    if not matter:
        raise HTTPException(404, "案件不存在")
    audience = "external" if payload.audience == "external" else "internal"
    filename = f"{matter_id}-{'external' if audience == 'external' else 'internal'}.md"
    return PlainTextResponse(
        build_markdown(matter, audience),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/ai/status")
def ai_status() -> dict:
    return public_status()


@app.post("/api/ai/config")
def ai_config_update(payload: AIConfigPayload) -> dict:
    try:
        return set_runtime_config(payload.api_key.get_secret_value(), payload.model, payload.base_url, payload.protocol, payload.provider)
    except AIServiceError as error:
        raise HTTPException(error.status_code, str(error)) from error


@app.delete("/api/ai/config")
def ai_config_delete() -> dict:
    return clear_runtime_config()


@app.post("/api/ai/test")
def ai_connection_test() -> dict:
    try:
        return test_connection()
    except AIServiceError as error:
        raise HTTPException(error.status_code, str(error)) from error


@app.post("/api/ai/analyze")
def ai_analyze(payload: AIAnalyzePayload) -> dict:
    matter = get_matter(payload.matter_id)
    if not matter:
        raise HTTPException(404, "案件不存在")
    try:
        return analyze_ai(matter, payload.task, payload.selected_citations, payload.user_instruction)
    except AIServiceError as error:
        raise HTTPException(error.status_code, str(error)) from error


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC_DIR / "avatar.png")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str = ""):
    return FileResponse(STATIC_DIR / "index.html")
