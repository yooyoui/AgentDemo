import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.services.agent import public_research
from app.services.search import WebSearchError, search_web, settings


class FakeClient:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        if isinstance(self.response, list):
            return self.response.pop(0)
        return self.response


def response(status: int, payload: dict) -> httpx.Response:
    request = httpx.Request("POST", "https://api.deepseek.com/responses")
    return httpx.Response(status, json=payload, request=request)


def search_response(results: list[dict], include_search_call: bool = True) -> httpx.Response:
    output = []
    if include_search_call:
        output.append({"type": "web_search_call", "status": "completed", "action": {"type": "search"}})
    output.append({
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{"type": "output_text", "text": json.dumps({"results": results}, ensure_ascii=False)}],
    })
    return response(200, {"status": "completed", "model": "deepseek-v4-flash", "output": output})


class SearchServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_key = settings.llm_api_key
        self.original_base_url = settings.llm_base_url
        self.original_search_model = settings.llm_search_model
        self.original_retries = settings.llm_max_retries
        settings.llm_api_key = "test-deepseek-key"
        settings.llm_base_url = "https://api.deepseek.com"
        settings.llm_search_model = "deepseek-v4-pro"
        settings.llm_max_retries = 0

    def tearDown(self):
        settings.llm_api_key = self.original_key
        settings.llm_base_url = self.original_base_url
        settings.llm_search_model = self.original_search_model
        settings.llm_max_retries = self.original_retries

    async def test_success_uses_deepseek_native_web_search_and_normalizes_results(self):
        client = FakeClient(search_response([
            {"title": "示例结果", "url": "https://example.com/page", "content": "公开信息摘要", "published_date": "2026-09-11"},
            {"title": "无效链接", "url": "file:///secret", "content": "应被过滤", "published_date": None},
        ]))
        results = await search_web(" 示例查询 ", max_results=3, client=client)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://example.com/page")
        url, sent = client.calls[0]
        self.assertEqual(url, "https://api.deepseek.com/responses")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer test-deepseek-key")
        self.assertEqual(sent["json"]["model"], "deepseek-v4-pro")
        self.assertEqual(sent["json"]["input"], "示例查询")
        self.assertEqual(sent["json"]["tools"], [{"type": "web_search"}])
        self.assertEqual(sent["json"]["tool_choice"], "auto")
        self.assertEqual(sent["json"]["reasoning"], {"effort": "none"})
        self.assertEqual(sent["json"]["text"]["format"], {"type": "json_object"})

    async def test_missing_key_fails_without_calling_upstream(self):
        settings.llm_api_key = ""
        client = FakeClient()
        with self.assertRaisesRegex(WebSearchError, "尚未配置") as caught:
            await search_web("示例查询", client=client)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(client.calls, [])

    async def test_auth_failure_does_not_expose_key(self):
        client = FakeClient(response(401, {"detail": "test-deepseek-key"}))
        with self.assertRaisesRegex(WebSearchError, "鉴权失败") as caught:
            await search_web("示例查询", client=client)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertNotIn("test-deepseek-key", str(caught.exception))

    async def test_rate_limit_and_timeout_have_specific_status_codes(self):
        with self.assertRaises(WebSearchError) as caught:
            await search_web("示例查询", client=FakeClient(response(429, {})))
        self.assertEqual(caught.exception.status_code, 429)

        timeout = httpx.ReadTimeout("timeout", request=httpx.Request("POST", "https://api.deepseek.com/responses"))
        with self.assertRaises(WebSearchError) as caught:
            await search_web("示例查询", client=FakeClient(error=timeout))
        self.assertEqual(caught.exception.status_code, 504)

    async def test_response_without_real_search_call_is_rejected(self):
        without_search = FakeClient(search_response([
            {"title": "示例结果", "url": "https://example.com", "content": "摘要", "published_date": None}
        ], include_search_call=False))
        with self.assertRaisesRegex(WebSearchError, "未实际执行联网工具"):
            await search_web("示例查询", client=without_search)

    async def test_double_encoded_json_response_is_supported(self):
        encoded = json.dumps(json.dumps({"results": [
            {"title": "示例结果", "url": "https://example.com", "content": "摘要", "published_date": None}
        ]}, ensure_ascii=False), ensure_ascii=False)
        encoded_response = response(200, {"status": "completed", "output": [
            {"type": "web_search_call", "status": "completed"},
            {"type": "message", "content": [{"type": "output_text", "text": encoded}]}
        ]})
        results = await search_web("示例查询", client=FakeClient(encoded_response))
        self.assertEqual(results[0]["title"], "示例结果")

    async def test_json_surrounded_by_explanatory_text_is_supported(self):
        noisy_text = "搜索结果如下：\n```json\n" + json.dumps({"results": [
            {"title": "示例结果", "url": "https://example.com", "content": "摘要", "published_date": None}
        ]}, ensure_ascii=False) + "\n```"
        noisy_response = response(200, {"status": "completed", "output": [
            {"type": "web_search_call", "status": "completed"},
            {"type": "message", "content": [{"type": "output_text", "text": noisy_text}]}
        ]})
        results = await search_web("示例查询", client=FakeClient(noisy_response))
        self.assertEqual(results[0]["url"], "https://example.com")

    async def test_invalid_first_response_is_retried_then_succeeds(self):
        settings.llm_max_retries = 1
        invalid = response(200, {"status": "completed", "output": [
            {"type": "web_search_call", "status": "completed"},
            {"type": "message", "content": [{"type": "output_text", "text": "not-json"}]}
        ]})
        valid = search_response([
            {"title": "重试成功", "url": "https://example.com", "content": "摘要", "published_date": None}
        ])
        client = FakeClient([invalid, valid])
        with patch("app.services.search.asyncio.sleep", new=AsyncMock()) as sleep:
            results = await search_web("示例查询", client=client)
        self.assertEqual(results[0]["title"], "重试成功")
        self.assertEqual(len(client.calls), 2)
        sleep.assert_awaited_once()

    async def test_auth_failure_is_not_retried(self):
        settings.llm_max_retries = 2
        client = FakeClient(response(401, {}))
        with self.assertRaises(WebSearchError):
            await search_web("示例查询", client=client)
        self.assertEqual(len(client.calls), 1)

    async def test_incomplete_response_or_invalid_json_is_rejected(self):
        incomplete = response(200, {"status": "incomplete", "output": []})
        with self.assertRaisesRegex(WebSearchError, "未完成联网搜索"):
            await search_web("示例查询", client=FakeClient(incomplete))

        invalid_json = response(200, {"status": "completed", "output": [
            {"type": "web_search_call", "status": "completed"},
            {"type": "message", "content": [{"type": "output_text", "text": "not-json"}]},
        ]})
        with self.assertRaisesRegex(WebSearchError, "结果格式不正确"):
            await search_web("示例查询", client=FakeClient(invalid_json))

    async def test_public_research_reuses_deepseek_search_service(self):
        customer = SimpleNamespace(name="示例单位", industry="制造业", nature="民营", region="重庆")
        result = [{"title": "单位简介", "url": "https://example.com", "content": "公开介绍", "published_date": None}]
        with patch("app.services.agent.search_web", new=AsyncMock(return_value=result)) as mocked:
            facts, citations = await public_research(customer)
        query = mocked.await_args.args[0]
        self.assertIn("企业全称：示例单位", query)
        self.assertIn("企业性质、所属行业、成立时间、注册资本、企业规模、主营业务", query)
        self.assertIn("不要按字段分别搜索", query)
        self.assertEqual(mocked.await_args.kwargs, {"max_results": 8})
        self.assertEqual(facts[0]["confidence"], "公开来源")
        self.assertEqual(citations[0]["url"], "https://example.com")
        self.assertLessEqual(len(citations[0]["excerpt"]), 600)


class SearchApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_search_endpoint_returns_structured_results(self):
        result = [{"title": "示例结果", "url": "https://example.com/page", "content": "摘要", "published_date": None}]
        with patch("app.main.search_web", new=AsyncMock(return_value=result)) as mocked:
            response_value = self.client.post("/api/search", json={"query": " 政企数字化 ", "max_results": 3})
        self.assertEqual(response_value.status_code, 200)
        body = response_value.json()
        self.assertEqual(body["provider"], "deepseek")
        self.assertEqual(body["query"], "政企数字化")
        self.assertEqual(body["results"][0]["url"], "https://example.com/page")
        mocked.assert_awaited_once_with("政企数字化", 3)

    def test_search_endpoint_validates_input(self):
        response_value = self.client.post("/api/search", json={"query": " ", "max_results": 11})
        self.assertEqual(response_value.status_code, 422)

    def test_search_endpoint_maps_service_errors(self):
        error = WebSearchError("尚未配置 LLM_API_KEY，DeepSeek 联网搜索不可用", 503)
        with patch("app.main.search_web", new=AsyncMock(side_effect=error)):
            response_value = self.client.post("/api/search", json={"query": "示例查询"})
        self.assertEqual(response_value.status_code, 503)
        self.assertEqual(response_value.json()["detail"], str(error))


if __name__ == "__main__":
    unittest.main()
