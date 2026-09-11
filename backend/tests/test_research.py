import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.main import generate_customer_research, settings
from app.models import Customer
from app.services.agent import (
    RESEARCH_FIELDS,
    normalize_research_output,
    prepare_research_results,
)


def model_result(data):
    return SimpleNamespace(data=data, latency_ms=3, attempts=1)


def research_payload(*, missing=(), conflict=False):
    facts = []
    for _, label in RESEARCH_FIELDS:
        if label in missing:
            facts.append({
                "label": label,
                "value": "待补充",
                "confidence": "待补充",
                "source_url": None,
                "status": "待补充",
            })
        else:
            facts.append({
                "label": label,
                "value": f"{label}示例值",
                "confidence": "公开来源",
                "source_url": "https://example.com/profile",
                "status": "已核实",
            })
    return {
        "客户": "示例企业",
        "结构化档案": facts,
        "潜在信息化方向": ["信息化升级"],
        "待补充": list(missing),
        "主体冲突": conflict,
        "冲突说明": ["发现同名主体"] if conflict else [],
    }


class ResearchGenerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_key = settings.llm_api_key
        settings.llm_api_key = "test-key"
        self.customer = SimpleNamespace(
            name="示例企业",
            industry="制造业",
            nature="民营",
            region="重庆",
            notes="",
        )
        self.citations = [{
            "title": "企业官网",
            "url": "https://example.com/profile",
            "excerpt": "企业公开资料",
            "collected_at": "2026-09-11T00:00:00+00:00",
            "source_type": "企业官网或年报",
        }]
        self.public_result = (
            [{
                "label": "公开资料片段",
                "value": "企业公开资料",
                "confidence": "公开来源",
                "source_url": "https://example.com/profile",
            }],
            self.citations,
        )

    def tearDown(self):
        settings.llm_api_key = self.original_key

    async def test_complete_profile_uses_one_search_and_one_extraction(self):
        with (
            patch("app.main.public_research", new=AsyncMock(return_value=self.public_result)) as search,
            patch("app.main.call_llm", new=AsyncMock(return_value=model_result(research_payload()))) as llm,
        ):
            research, citations, metadata, model_call = await generate_customer_research(self.customer, "客户摸底")
        self.assertEqual(search.await_count, 1)
        self.assertEqual(llm.await_count, 1)
        self.assertEqual(metadata["search_rounds"], 1)
        self.assertEqual(metadata["critical_field_coverage_percent"], 100)
        self.assertEqual(model_call["calls"], 1)
        self.assertEqual(len(research["结构化档案"]), 10)
        self.assertEqual(citations, self.citations)

    async def test_noncritical_missing_field_does_not_trigger_followup(self):
        first = research_payload(missing={"成立时间"})
        with (
            patch("app.main.public_research", new=AsyncMock(return_value=self.public_result)) as search,
            patch("app.main.call_llm", new=AsyncMock(return_value=model_result(first))) as llm,
        ):
            research, _, metadata, _ = await generate_customer_research(self.customer, "客户摸底")
        self.assertEqual(search.await_count, 1)
        self.assertEqual(llm.await_count, 1)
        self.assertEqual(metadata["search_rounds"], 1)
        founded = next(item for item in research["结构化档案"] if item["label"] == "成立时间")
        self.assertEqual(founded["status"], "待补充")

    async def test_missing_critical_fields_use_one_combined_followup(self):
        first = research_payload(missing={"企业规模", "官方网站"})
        second = research_payload()
        with (
            patch("app.main.public_research", new=AsyncMock(side_effect=[self.public_result, self.public_result])) as search,
            patch("app.main.call_llm", new=AsyncMock(side_effect=[model_result(first), model_result(second)])) as llm,
        ):
            _, _, metadata, model_call = await generate_customer_research(self.customer, "客户摸底")
        self.assertEqual(search.await_count, 2)
        self.assertEqual(llm.await_count, 2)
        self.assertEqual(search.await_args_list[1].args[1], ["企业规模", "官方网站"])
        self.assertFalse(search.await_args_list[1].args[2])
        self.assertEqual(metadata["search_rounds"], 2)
        self.assertEqual(model_call["calls"], 2)

    async def test_entity_conflict_triggers_one_disambiguation_followup(self):
        first = research_payload(conflict=True)
        second = research_payload()
        with (
            patch("app.main.public_research", new=AsyncMock(side_effect=[self.public_result, self.public_result])) as search,
            patch("app.main.call_llm", new=AsyncMock(side_effect=[model_result(first), model_result(second)])),
        ):
            _, _, metadata, _ = await generate_customer_research(self.customer, "客户摸底")
        self.assertEqual(search.await_count, 2)
        self.assertEqual(search.await_args_list[1].args[1], [])
        self.assertTrue(search.await_args_list[1].args[2])
        self.assertFalse(metadata["entity_conflict"])

    async def test_still_missing_after_followup_never_triggers_third_search(self):
        incomplete = research_payload(missing={"企业规模"})
        with (
            patch("app.main.public_research", new=AsyncMock(side_effect=[self.public_result, self.public_result])) as search,
            patch("app.main.call_llm", new=AsyncMock(side_effect=[model_result(incomplete), model_result(incomplete)])),
        ):
            research, _, metadata, _ = await generate_customer_research(self.customer, "客户摸底")
        self.assertEqual(search.await_count, 2)
        self.assertEqual(metadata["search_rounds"], 2)
        self.assertEqual(metadata["critical_field_coverage_percent"], 75)
        scale = next(item for item in research["结构化档案"] if item["label"] == "企业规模")
        self.assertEqual(scale["status"], "待补充")

    def test_invalid_public_url_is_downgraded_to_pending(self):
        payload = research_payload()
        payload["结构化档案"][2]["source_url"] = "https://untrusted.example/fake"
        normalized, _ = normalize_research_output(payload, self.customer, self.citations)
        founded = normalized["结构化档案"][2]
        self.assertEqual(founded["value"], "待补充")
        self.assertEqual(founded["status"], "待补充")
        self.assertEqual(founded["sources"], [])

    def test_invalid_public_industry_falls_back_to_user_input(self):
        payload = research_payload()
        payload["结构化档案"][1]["source_url"] = "https://untrusted.example/fake"
        normalized, _ = normalize_research_output(payload, self.customer, self.citations)
        industry = normalized["结构化档案"][1]
        self.assertEqual(industry["value"], "制造业")
        self.assertEqual(industry["status"], "用户提供")
        self.assertEqual(industry["source_url"], None)

    def test_sources_are_deduplicated_prioritized_and_truncated(self):
        results = [
            {"title": "普通聚合页", "url": "https://example.com/a#part", "content": "a" * 700},
            {"title": "重复页", "url": "https://example.com/a", "content": "重复"},
            {"title": "政府公示", "url": "https://www.gov.cn/company", "content": "政府信息"},
        ]
        prepared = prepare_research_results(results, 8)
        self.assertEqual(len(prepared), 2)
        self.assertEqual(prepared[0]["source_type"], "政府及法定公示")
        self.assertEqual(len(prepared[1]["content"]), 600)


class ResearchApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.test_session = sessionmaker(bind=engine, expire_on_commit=False)

        def override_db():
            with self.test_session() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        with self.test_session() as db:
            customer = Customer(name="接口测试企业", industry="制造业", nature="民营", region="重庆")
            db.add(customer)
            db.commit()
            self.customer_id = customer.id
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)

    def test_single_research_endpoint_creates_async_task(self):
        with patch("app.main.execute_research", new=AsyncMock()) as execute:
            response = self.client.post(f"/api/customers/{self.customer_id}/research")
        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertEqual(body["task_type"], "research")
        self.assertEqual(body["status"], "queued")
        execute.assert_awaited_once_with(body["id"])

    def test_single_research_endpoint_rejects_unknown_customer(self):
        response = self.client.post("/api/customers/not-found/research")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
