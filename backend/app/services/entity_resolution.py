import hashlib
import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import EntityResolutionCache
from .agent import call_llm, prepare_research_results
from .outputs import EntityResolutionOutput
from .search import search_web


ENTITY_EXAMPLE = {
    "candidates": [{
        "canonical_name": "重庆示例智能装备有限公司",
        "entity_type": "企业",
        "region": "重庆市",
        "industry": "智能装备制造",
        "official_url": "https://example.com",
        "registration_code": None,
        "evidence_urls": ["https://example.com"],
    }]
}


def normalize_name(value: str) -> str:
    return re.sub(r"[\s·•,，。()（）\-—_]+", "", value).casefold()


def cache_key(name: str, region: str, industry: str) -> str:
    raw = "|".join((normalize_name(name), normalize_name(region), normalize_name(industry)))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _authoritative(evidence: list[dict]) -> bool:
    return any(item.get("source_type") in {"政府及法定公示", "法定披露", "企业官网或年报"} for item in evidence)


def _region_short(value: str) -> str:
    normalized = normalize_name(value)
    return re.sub(r"(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市|地区|盟)$", "", normalized)


def _operator_alias_match(query: str, canonical_name: str, region: str, candidate_region: str) -> bool:
    """Recognize common aliases such as 惠州移动/惠州电信/惠州联通."""
    brands = ("移动", "电信", "联通", "铁塔", "广电")
    query_brand = next((brand for brand in brands if brand in query), None)
    if not query_brand or query_brand not in canonical_name:
        return False
    region_tokens = {_region_short(region), _region_short(candidate_region)} - {""}
    return any(token in query and token in canonical_name for token in region_tokens)


def _rank(candidate: dict, query_name: str, region: str, industry: str) -> dict:
    query, name = normalize_name(query_name), normalize_name(candidate["canonical_name"])
    reasons: list[str] = []
    if query == name:
        score = 55
        reasons.append("名称完全一致")
    elif query in name or name in query:
        score = 40
        reasons.append("名称包含匹配")
    else:
        similarity = SequenceMatcher(None, query, name).ratio()
        score = round(similarity * 35)
        if similarity >= 0.6:
            reasons.append("名称相似")
    candidate_region = normalize_name(candidate.get("region", ""))
    if _operator_alias_match(query, name, region, candidate_region):
        score = max(score, 50)
        reasons.append("运营商地区简称匹配")
    if region and normalize_name(region) in candidate_region:
        score += 15
        reasons.append("地区一致")
    candidate_industry = normalize_name(candidate.get("industry", ""))
    if industry and normalize_name(industry) in candidate_industry:
        score += 10
        reasons.append("行业一致")
    if _authoritative(candidate["evidence"]):
        score += 20
        reasons.append("存在权威来源")
    score = min(score, 100)
    confidence = "high" if score >= 75 and _authoritative(candidate["evidence"]) else "medium" if score >= 50 else "low"
    return {**candidate, "score": score, "confidence": confidence, "match_reasons": reasons or ["公开信息弱匹配"]}


async def resolve_entities(db: Session, name: str, region: str, industry: str) -> tuple[list[dict], bool, int | None]:
    key = cache_key(name, region, industry)
    now = datetime.now(timezone.utc)
    cached = db.scalar(select(EntityResolutionCache).where(EntityResolutionCache.cache_key == key, EntityResolutionCache.expires_at > now))
    if cached:
        # Ranking rules evolve independently from the expensive search result.
        # Re-rank cached evidence locally so fixes take effect without another web call.
        candidates = [_rank(dict(item), name, region, industry) for item in cached.candidates]
        candidates.sort(key=lambda item: (-item["score"], item["canonical_name"]))
        candidates = candidates[:3]
        if candidates != cached.candidates:
            cached.candidates = candidates
            db.commit()
        auto = 0 if len(candidates) == 1 and candidates[0].get("confidence") == "high" else None
        return candidates, True, auto

    query = (
        f"识别组织主体：名称或简称“{name}”，地区“{region or '未知'}”，行业“{industry or '未知'}”。"
        "一次性查找可能的企业、政府、学校、医院或其他组织主体，重点核对法定全称、地区、行业、官网和统一社会信用代码。"
        "优先政府公示、法定披露与组织官网；只要存在直接证据，即使名称只是简称或置信度不足也保留，最多返回3个候选。"
    )
    results = prepare_research_results(await search_web(query, max_results=8), 8)
    sources = [{
        "title": item["title"],
        "url": str(item["url"]),
        "excerpt": item.get("content", "")[:600],
        "source_type": item.get("source_type", "其他公开来源"),
    } for item in results]
    allowed = {item["url"]: item for item in sources}
    model = await call_llm(
        "根据公开来源提取可能的组织主体候选。只输出 JSON；不得创造来源、主体或统一社会信用代码。"
        "每个候选必须至少有一个本轮来源；有证据的低置信候选也要保留，按相关性最多返回3个，完全没有证据时才返回空 candidates。",
        {"query": {"name": name, "region": region, "industry": industry}, "public_sources": sources},
        EntityResolutionOutput,
        ENTITY_EXAMPLE,
    )
    raw_candidates = model.data.get("candidates", []) if model else []
    candidates: list[dict] = []
    seen: set[str] = set()
    for raw in raw_candidates:
        urls = [str(url) for url in raw.get("evidence_urls", []) if str(url) in allowed]
        canonical = str(raw.get("canonical_name", "")).strip()
        normalized = normalize_name(canonical)
        if not canonical or not urls or normalized in seen:
            continue
        seen.add(normalized)
        official_url = str(raw.get("official_url") or "") or None
        if official_url and official_url not in allowed:
            official_url = None
        item = {
            "canonical_name": canonical,
            "entity_type": str(raw.get("entity_type") or "其他组织"),
            "region": str(raw.get("region") or "待补充"),
            "industry": str(raw.get("industry") or "待补充"),
            "official_url": official_url,
            "registration_code": raw.get("registration_code"),
            "evidence": [allowed[url] for url in urls],
        }
        candidates.append(_rank(item, name, region, industry))
    candidates.sort(key=lambda item: (-item["score"], item["canonical_name"]))
    candidates = candidates[:3]
    stale = db.scalar(select(EntityResolutionCache).where(EntityResolutionCache.cache_key == key))
    if stale:
        stale.candidates, stale.created_at, stale.expires_at = candidates, now, now + timedelta(days=7)
    else:
        db.add(EntityResolutionCache(cache_key=key, query_name=name, region=region, industry=industry, candidates=candidates, expires_at=now + timedelta(days=7)))
    db.commit()
    auto = 0 if len(candidates) == 1 and candidates[0]["confidence"] == "high" else None
    return candidates, False, auto
