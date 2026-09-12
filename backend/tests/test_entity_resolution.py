import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Customer, EntityResolutionCache, OrganizationIdentity
from app.services.entity_resolution import normalize_name, resolve_entities


class EntityResolutionServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    async def test_one_combined_search_returns_ranked_top_three_and_caches(self):
        search_results = [
            {"title": "重庆市企业公示", "url": "https://www.cq.gov.cn/xihai", "content": "重庆西海智能装备有限公司，位于重庆，从事智能装备制造。"},
            {"title": "无关页面", "url": "https://example.com/other", "content": "无关主体"},
        ]
        candidates = [{
            "canonical_name": f"重庆西海智能装备有限公司{suffix}",
            "entity_type": "企业",
            "region": "重庆市",
            "industry": "智能装备制造",
            "official_url": None,
            "registration_code": None,
            "evidence_urls": ["https://www.cq.gov.cn/xihai"],
        } for suffix in ("", "一分公司", "二分公司", "三分公司")]
        model = SimpleNamespace(data={"candidates": candidates}, latency_ms=1, attempts=1)
        with self.session_factory() as db:
            with (
                patch("app.services.entity_resolution.search_web", new=AsyncMock(return_value=search_results)) as search,
                patch("app.services.entity_resolution.call_llm", new=AsyncMock(return_value=model)) as llm,
            ):
                first, cache_hit, _ = await resolve_entities(db, "重庆西海智能装备", "重庆", "智能装备")
                second, second_hit, _ = await resolve_entities(db, "重庆西海智能装备", "重庆", "智能装备")
            self.assertEqual(search.await_count, 1)
            self.assertEqual(llm.await_count, 1)
            self.assertFalse(cache_hit)
            self.assertTrue(second_hit)
            self.assertEqual(first, second)
            self.assertEqual(len(first), 3)
            self.assertEqual(first[0]["canonical_name"], "重庆西海智能装备有限公司")
            self.assertEqual(first[0]["confidence"], "high")
            self.assertEqual(first[0]["evidence"][0]["source_type"], "政府及法定公示")
            self.assertEqual(db.query(EntityResolutionCache).count(), 1)

    async def test_rejects_model_sources_outside_current_search_allowlist(self):
        search_results = [{"title": "官网", "url": "https://example.com/company", "content": "某组织"}]
        model = SimpleNamespace(data={"candidates": [{
            "canonical_name": "伪造组织有限公司", "entity_type": "企业", "region": "重庆", "industry": "制造",
            "official_url": "https://evil.example/fake", "registration_code": None,
            "evidence_urls": ["https://evil.example/fake"],
        }]}, latency_ms=1, attempts=1)
        with self.session_factory() as db, patch("app.services.entity_resolution.search_web", new=AsyncMock(return_value=search_results)), patch("app.services.entity_resolution.call_llm", new=AsyncMock(return_value=model)):
            candidates, _, _ = await resolve_entities(db, "伪造组织", "重庆", "制造")
        self.assertEqual(candidates, [])

    def test_normalize_name_handles_spaces_and_punctuation(self):
        self.assertEqual(normalize_name(" 重庆·西海（智能）装备有限公司 "), "重庆西海智能装备有限公司")


class EntityResolutionApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.session_factory = sessionmaker(bind=engine, expire_on_commit=False)

        def override_db():
            with self.session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        with self.session_factory() as db:
            customer = Customer(name="西海智能", industry="智能装备", nature="民营", region="重庆")
            other = Customer(name="重庆西海工业设备有限公司", industry="制造", nature="民营", region="重庆")
            db.add_all([customer, other]); db.commit()
            self.customer_id = customer.id
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)

    def candidate(self):
        return {
            "canonical_name": "重庆西海智能装备有限公司", "entity_type": "企业", "region": "重庆市", "industry": "智能装备制造",
            "official_url": "https://example.com", "registration_code": "91500000TEST", "score": 92, "confidence": "high",
            "match_reasons": ["地区一致", "存在权威来源"],
            "evidence": [{"title": "政府公示", "url": "https://example.com", "excerpt": "企业登记信息", "source_type": "政府及法定公示"}],
        }

    def test_local_fuzzy_search_and_verified_confirmation(self):
        matches = self.client.get("/api/v1/customers/search", params={"q": "西海智能"})
        self.assertEqual(matches.status_code, 200)
        self.assertEqual(matches.json()[0]["customer"]["id"], self.customer_id)
        confirmed = self.client.post(f"/api/v1/customers/{self.customer_id}/identity", json={"entered_name": "西海智能", "candidate": self.candidate()})
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.json()["verification_status"], "verified")
        self.assertEqual(confirmed.json()["entered_name"], "西海智能")
        self.assertEqual(confirmed.json()["canonical_name"], "重庆西海智能装备有限公司")
        read = self.client.get(f"/api/v1/customers/{self.customer_id}/identity")
        self.assertEqual(read.status_code, 200)

    def test_explicit_entered_name_is_unverified_and_choice_is_exclusive(self):
        response = self.client.post(f"/api/v1/customers/{self.customer_id}/identity", json={"entered_name": "西海智能", "use_entered_name": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["verification_status"], "unverified")
        invalid = self.client.post(f"/api/v1/customers/{self.customer_id}/identity", json={"entered_name": "西海智能"})
        self.assertEqual(invalid.status_code, 422)

    def test_customer_delete_also_deletes_identity(self):
        self.client.post(f"/api/v1/customers/{self.customer_id}/identity", json={"entered_name": "西海智能", "use_entered_name": True})
        response = self.client.request("DELETE", f"/api/customers/{self.customer_id}", json={"confirmation_name": "西海智能"})
        self.assertEqual(response.status_code, 204)
        with self.session_factory() as db:
            self.assertEqual(db.query(OrganizationIdentity).count(), 0)


if __name__ == "__main__":
    unittest.main()
