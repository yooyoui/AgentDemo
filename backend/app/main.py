import shutil
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .models import Artifact, ArtifactType, Customer, ExportArtifact, GenerationTask, KnowledgeDocument, PromptTemplate
from .schemas import AnalyzeRequest, ArtifactRead, ArtifactUpdate, CustomerCreate, CustomerRead, KnowledgeRead, ModelTestRead, PromptRead, PromptUpdate, TaskRead
from .services.agent import LLMCallError, call_llm, clean_untrusted, demo_capabilities, demo_requirements, demo_script, demo_solution, public_research, retrieve_knowledge
from .services.documents import ALLOWED_EXTENSIONS, chunk_text, extract_text
from .services.exporter import export_docx, export_pdf
from .services.outputs import CapabilitiesOutput, ConnectionTestOutput, RequirementsOutput, ResearchOutput, SolutionOutput, VisitScriptOutput


settings = get_settings()
Base.metadata.create_all(bind=engine)
app = FastAPI(title=settings.app_name, version="0.1.0", docs_url="/api/docs")
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
requests_by_ip: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def basic_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        key = request.client.host if request.client else "local"
        now = time.time()
        bucket = requests_by_ip[key]
        while bucket and bucket[0] < now - 60:
            bucket.popleft()
        if len(bucket) >= 120:
            raise HTTPException(429, "请求过于频繁，请稍后重试")
        bucket.append(now)
    return await call_next(request)


DEFAULT_PROMPTS = {
    "research": "基于可信公开信息建立客户画像，所有外部事实必须附来源，无法确认的信息标记待补充。",
    "requirements": "从沟通原文提取显性需求、隐性痛点、建设期望、关注事项、待确认问题与原文依据。",
    "capabilities": "仅依据内部知识库匹配移动产品、服务、方案和案例，没有内部证据时不得推荐。",
    "solution": "形成轻量、分阶段、可落地的初步方案，不生成未经确认的报价、工期或能力承诺。",
    "script": "按开场、背景确认、需求深挖、方案讲解、异议处理、收尾跟进六阶段生成话术。",
}

OUTPUT_EXAMPLES = {
    "research": {
        "客户": "示例单位",
        "结构化档案": [{"label": "所属行业", "value": "制造业", "confidence": "用户提供", "source_url": None}],
        "潜在信息化方向": ["生产流程数字化"],
        "待补充": ["现有信息化系统"],
    },
    "requirements": {
        "显性需求": ["提升跨部门协同效率"],
        "隐性痛点": ["资料依赖人工汇总"],
        "建设期望": ["分阶段形成统一协同入口"],
        "关注事项": ["数据安全"],
        "待确认问题": ["现有系统接口条件如何？"],
        "原文依据": ["客户希望提升跨部门协同效率"],
    },
    "capabilities": {
        "匹配结果": [{"能力": "园区协同平台", "类别": "行业方案", "匹配理由": "与协同需求匹配", "适用条件": "需完成接口调研", "引用": "统一工作入口，减少人工汇总", "document_id": "资料编号"}],
        "提示": None,
    },
    "solution": {
        "客户现状": "当前资料依赖人工汇总，具体范围待核实。",
        "建设目标": ["提升协同效率"],
        "方案组合": ["园区协同平台"],
        "建设思路": ["先调研，再试点，后推广"],
        "预期价值": ["减少人工汇总"],
        "风险边界": ["具体能力以正式材料确认为准"],
    },
    "script": {
        "拜访设置": {"类型": "首次拜访", "客户角色": "业务负责人", "表达风格": "专业务实"},
        "阶段": [
            {"名称": name, "目标": "确认相关信息", "推荐表达": "请结合实际情况进一步介绍。", "问题": []}
            for name in ("开场破冰", "背景确认", "需求深挖", "方案讲解", "异议处理", "收尾跟进")
        ],
        "禁止承诺": ["不承诺未经确认的能力、报价、工期或服务内容"],
    },
    "connection": {"status": "ok"},
}


def active_prompt(db: Session, task_type: str) -> tuple[str, str]:
    prompt = db.scalar(select(PromptTemplate).where(PromptTemplate.task_type == task_type, PromptTemplate.enabled.is_(True)))
    if prompt:
        return prompt.content, prompt.version
    return DEFAULT_PROMPTS[task_type], "built-in"


def safe_error(exc: Exception) -> str:
    message = str(exc) or exc.__class__.__name__
    for secret in (settings.llm_api_key, settings.tavily_api_key):
        if secret:
            message = message.replace(secret, "[已隐藏]")
    return message[:1000]


@app.on_event("startup")
def seed_prompts():
    with SessionLocal() as db:
        for task_type, content in DEFAULT_PROMPTS.items():
            if not db.scalar(select(PromptTemplate).where(PromptTemplate.task_type == task_type)):
                db.add(PromptTemplate(task_type=task_type, name=task_type, content=content))
        db.commit()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "provider": "deepseek" if settings.llm_api_key else "demo",
        "model": settings.llm_model if settings.llm_api_key else "demo-rules",
        "model_status": "configured" if settings.llm_api_key else "demo",
        "research": "tavily" if settings.tavily_api_key else "demo",
    }


@app.post("/api/model/test", response_model=ModelTestRead)
async def test_model_connection():
    if not settings.llm_api_key:
        return ModelTestRead(status="demo", provider="demo", model="demo-rules", error="尚未配置 LLM_API_KEY")
    try:
        result = await call_llm("这是模型连通性测试。", {"instruction": "返回连接成功状态"}, ConnectionTestOutput, OUTPUT_EXAMPLES["connection"])
        return ModelTestRead(status="ok", provider="deepseek", model=settings.llm_model, latency_ms=result.latency_ms if result else None)
    except Exception as exc:
        return ModelTestRead(status="failed", provider="deepseek", model=settings.llm_model, error=safe_error(exc))


@app.get("/api/customers", response_model=list[CustomerRead])
def list_customers(db: Session = Depends(get_db)):
    return db.scalars(select(Customer).order_by(Customer.created_at.desc())).all()


@app.post("/api/customers", response_model=CustomerRead, status_code=201)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)):
    customer = Customer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@app.get("/api/customers/{customer_id}", response_model=CustomerRead)
def get_customer(customer_id: str, db: Session = Depends(get_db)):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "客户不存在")
    return customer


@app.get("/api/knowledge", response_model=list[KnowledgeRead])
def list_knowledge(db: Session = Depends(get_db)):
    return db.scalars(select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc())).all()


@app.post("/api/knowledge", response_model=KnowledgeRead, status_code=201)
async def upload_knowledge(file: UploadFile = File(...), category: str = Form("产品"), version: str = Form("1.0"), db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "仅支持 PDF、Word、PPT、Excel、TXT 和 Markdown")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"文件不能超过 {settings.max_upload_mb}MB")
    safe_name = f"{uuid.uuid4()}{suffix}"
    path = settings.storage_dir / safe_name
    path.write_bytes(data)
    try:
        content = extract_text(path)
        if not content.strip():
            raise ValueError("文档中没有可提取文字")
        record = KnowledgeDocument(filename=Path(file.filename or safe_name).name, category=category, version=version, path=str(path), content=clean_untrusted(content), chunks=chunk_text(clean_untrusted(content)))
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(422, f"文档解析失败：{exc}") from exc


@app.get("/api/prompts", response_model=list[PromptRead])
def list_prompts(db: Session = Depends(get_db)):
    return db.scalars(select(PromptTemplate).order_by(PromptTemplate.task_type)).all()


@app.put("/api/prompts/{task_type}", response_model=PromptRead)
def update_prompt(task_type: str, payload: PromptUpdate, db: Session = Depends(get_db)):
    prompt = db.scalar(select(PromptTemplate).where(PromptTemplate.task_type == task_type))
    if not prompt:
        prompt = PromptTemplate(task_type=task_type, **payload.model_dump())
        db.add(prompt)
    else:
        for key, value in payload.model_dump().items():
            setattr(prompt, key, value)
    db.commit()
    db.refresh(prompt)
    return prompt


def upsert_artifact(db: Session, customer_id: str, kind: ArtifactType, title: str, content: dict, citations: list | None = None) -> Artifact:
    artifact = db.scalar(select(Artifact).where(Artifact.customer_id == customer_id, Artifact.type == kind).order_by(Artifact.version.desc()))
    if artifact:
        artifact.content = content
        artifact.citations = citations or []
        artifact.version += 1
        artifact.confirmed = False
    else:
        artifact = Artifact(customer_id=customer_id, type=kind, title=title, content=content, citations=citations or [])
        db.add(artifact)
    db.flush()
    return artifact


async def execute_flow(task_id: str, payload: dict):
    with SessionLocal() as db:
        task = db.get(GenerationTask, task_id)
        customer = db.get(Customer, task.customer_id) if task else None
        if not task or not customer:
            return
        try:
            task.status, task.progress = "running", 8
            db.commit()
            prompts = {task_type: active_prompt(db, task_type) for task_type in DEFAULT_PROMPTS}
            prompt_versions = {task_type: version for task_type, (_, version) in prompts.items()}
            model_calls: dict[str, dict] = {}

            facts, citations = await public_research(customer)
            research_fallback = {"客户": customer.name, "结构化档案": facts, "潜在信息化方向": ["业务流程数字化", "数据治理与决策支撑", "网络、云与安全能力升级"], "待补充": ["过往合作记录", "现有信息化系统", "年度重点项目与预算安排"]}
            research_result = await call_llm(
                prompts["research"][0] + " 所有标记为公开来源的事实必须填写输入来源中完全一致的 source_url；没有来源时只能标记为用户提供、待核实或待补充。",
                {
                    "customer": {"name": customer.name, "industry": customer.industry, "nature": customer.nature, "region": customer.region, "notes": clean_untrusted(customer.notes)},
                    "public_facts": facts,
                    "public_sources": citations,
                },
                ResearchOutput,
                OUTPUT_EXAMPLES["research"],
            )
            research = research_result.data if research_result else research_fallback
            if research.get("客户") != customer.name:
                raise LLMCallError("客户摸底结果中的客户名称不一致")
            allowed_urls = {citation.get("url") for citation in citations if citation.get("url")}
            provided_values = {customer.name, customer.industry, customer.nature, customer.region}
            for fact in research.get("结构化档案", []):
                if fact.get("confidence") == "公开来源" and fact.get("source_url") not in allowed_urls:
                    raise LLMCallError("客户摸底包含无法对应公开来源的事实")
                if fact.get("confidence") == "用户提供" and fact.get("value") not in provided_values and fact.get("value") not in customer.notes:
                    raise LLMCallError("客户摸底包含无法对应用户输入的事实")
            if research_result:
                model_calls["research"] = {"latency_ms": research_result.latency_ms, "attempts": research_result.attempts}
            upsert_artifact(db, customer.id, ArtifactType.research, "客户摸底", research, citations)
            task.progress = 28
            db.commit()

            communication = clean_untrusted(payload.get("communication", ""))
            requirements_result = await call_llm(
                prompts["requirements"][0] + " 原文依据必须逐字摘自沟通原文，不能改写。",
                {"customer": customer.name, "communication": communication},
                RequirementsOutput,
                OUTPUT_EXAMPLES["requirements"],
            )
            requirements = requirements_result.data if requirements_result else demo_requirements(communication)
            if communication and not requirements.get("原文依据"):
                raise LLMCallError("需求拆解缺少可定位的原文依据")
            if any(evidence not in communication for evidence in requirements.get("原文依据", [])):
                raise LLMCallError("需求拆解中的原文依据无法在沟通记录中定位")
            if requirements_result:
                model_calls["requirements"] = {"latency_ms": requirements_result.latency_ms, "attempts": requirements_result.attempts}
            upsert_artifact(db, customer.id, ArtifactType.requirements, "需求拆解", requirements)
            task.progress = 48
            db.commit()

            documents = db.scalars(select(KnowledgeDocument).where(KnowledgeDocument.status == "ready")).all()
            refs = retrieve_knowledge(documents, customer.name + " " + communication + " " + str(requirements))
            capabilities_result = None
            if refs:
                capabilities_result = await call_llm(
                    prompts["capabilities"][0] + " 只能选择输入的内部资料；document_id 必须完全一致；引用必须逐字摘自对应 excerpt。",
                    {"requirements": requirements, "internal_evidence": refs},
                    CapabilitiesOutput,
                    OUTPUT_EXAMPLES["capabilities"],
                )
            if capabilities_result:
                refs_by_id = {ref["document_id"]: ref for ref in refs}
                visible_matches = []
                selected_refs = []
                for match in capabilities_result.data.get("匹配结果", []):
                    document_id = match.pop("document_id", "")
                    reference = refs_by_id.get(document_id)
                    if not reference:
                        raise LLMCallError("能力匹配引用了不存在的内部资料")
                    if match.get("引用", "") not in reference.get("excerpt", ""):
                        raise LLMCallError("能力匹配的引用无法在内部资料原文中定位")
                    visible_matches.append(match)
                    selected_refs.append(reference)
                capabilities = {"匹配结果": visible_matches}
                if capabilities_result.data.get("提示"):
                    capabilities["提示"] = capabilities_result.data["提示"]
                capability_citations = selected_refs
                model_calls["capabilities"] = {"latency_ms": capabilities_result.latency_ms, "attempts": capabilities_result.attempts}
            else:
                capabilities = demo_capabilities(requirements, refs)
                capability_citations = refs
            upsert_artifact(db, customer.id, ArtifactType.capabilities, "移动能力匹配", capabilities, capability_citations)
            task.progress = 66
            db.commit()

            solution_result = await call_llm(
                prompts["solution"][0] + " 方案组合只能使用能力匹配结果中的能力名称；风险边界必须明确禁止未经确认的报价、工期和服务承诺。",
                {"customer": customer.name, "research": research, "requirements": requirements, "capabilities": capabilities},
                SolutionOutput,
                OUTPUT_EXAMPLES["solution"],
            )
            solution = solution_result.data if solution_result else demo_solution(customer, requirements, capabilities)
            allowed_capabilities = {item.get("能力") for item in capabilities.get("匹配结果", [])}
            allowed_solution_items = allowed_capabilities | {"待知识库补充后匹配"}
            if any(item not in allowed_solution_items for item in solution.get("方案组合", [])):
                raise LLMCallError("初步方案包含未经内部资料匹配的能力")
            if solution_result:
                model_calls["solution"] = {"latency_ms": solution_result.latency_ms, "attempts": solution_result.attempts}
            upsert_artifact(db, customer.id, ArtifactType.solution, "初步解决方案", solution, capability_citations)
            task.progress = 82
            db.commit()

            script_result = await call_llm(
                prompts["script"][0] + " 必须严格按规定顺序输出六个阶段，禁止承诺必须保留方案中的风险边界。",
                {"customer": customer.name, "requirements": requirements, "solution": solution, **payload},
                VisitScriptOutput,
                OUTPUT_EXAMPLES["script"],
            )
            script = script_result.data if script_result else demo_script(customer, requirements, solution, payload.get("visit_type", "首次拜访"), payload.get("customer_role", "业务负责人"), payload.get("style", "专业务实"))
            if any(boundary not in script.get("禁止承诺", []) for boundary in solution.get("风险边界", [])):
                raise LLMCallError("拜访话术未完整保留方案风险边界")
            if script_result:
                model_calls["script"] = {"latency_ms": script_result.latency_ms, "attempts": script_result.attempts}
            upsert_artifact(db, customer.id, ArtifactType.script, "拜访话术", script)
            task.status, task.progress, task.output, task.finished_at = "completed", 100, {
                "message": "完整拜访材料已生成",
                "prompt_versions": prompt_versions,
                "model_calls": model_calls,
            }, datetime.now(timezone.utc)
            db.commit()
        except Exception as exc:
            task.status, task.error, task.finished_at = "failed", safe_error(exc), datetime.now(timezone.utc)
            db.commit()


@app.post("/api/customers/{customer_id}/run-all", response_model=TaskRead, status_code=202)
def run_all(customer_id: str, payload: AnalyzeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if not db.get(Customer, customer_id):
        raise HTTPException(404, "客户不存在")
    task = GenerationTask(customer_id=customer_id, task_type="run-all", input_snapshot=payload.model_dump(), model=settings.llm_model if settings.llm_api_key else "demo-rules")
    db.add(task)
    db.commit()
    db.refresh(task)
    background_tasks.add_task(execute_flow, task.id, payload.model_dump())
    return task


@app.get("/api/tasks/{task_id}", response_model=TaskRead)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.get(GenerationTask, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    return task


@app.get("/api/artifacts", response_model=list[ArtifactRead])
def list_artifacts(customer_id: str, db: Session = Depends(get_db)):
    return db.scalars(select(Artifact).where(Artifact.customer_id == customer_id).order_by(Artifact.created_at)).all()


@app.put("/api/artifacts/{artifact_id}", response_model=ArtifactRead)
def update_artifact(artifact_id: str, payload: ArtifactUpdate, db: Session = Depends(get_db)):
    artifact = db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "成果不存在")
    artifact.content = payload.content
    artifact.version += 1
    artifact.confirmed = False
    db.commit()
    db.refresh(artifact)
    return artifact


@app.post("/api/artifacts/{artifact_id}/confirm", response_model=ArtifactRead)
def confirm_artifact(artifact_id: str, db: Session = Depends(get_db)):
    artifact = db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "成果不存在")
    artifact.confirmed = True
    db.commit()
    db.refresh(artifact)
    return artifact


@app.post("/api/customers/{customer_id}/export/{file_format}")
def export_customer(customer_id: str, file_format: str, db: Session = Depends(get_db)):
    if file_format not in {"docx", "pdf"}:
        raise HTTPException(400, "仅支持 docx 或 pdf")
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "客户不存在")
    artifacts = db.scalars(select(Artifact).where(Artifact.customer_id == customer_id).order_by(Artifact.created_at)).all()
    if not artifacts:
        raise HTTPException(409, "请先生成拜访材料")
    if not all(x.confirmed for x in artifacts):
        raise HTTPException(409, "所有材料人工确认后才能导出")
    path = settings.export_dir / f"{customer.id}-{int(time.time())}.{file_format}"
    (export_docx if file_format == "docx" else export_pdf)(path, customer.name, artifacts)
    db.add(ExportArtifact(customer_id=customer_id, format=file_format, path=str(path)))
    db.commit()
    media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" if file_format == "docx" else "application/pdf"
    return FileResponse(path, media_type=media, filename=f"{customer.name}拜访准备材料.{file_format}")
