import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.services.agent import LLMCallError, call_llm, settings
from app.services.outputs import ConnectionTestOutput, RequirementsOutput


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def response(status: int, payload: dict) -> httpx.Response:
    request = httpx.Request("POST", "https://api.deepseek.com/chat/completions")
    return httpx.Response(status, json=payload, request=request)


def completion(content: str) -> httpx.Response:
    return response(200, {"choices": [{"message": {"content": content}}]})


class LLMTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_key = settings.llm_api_key
        self.original_retries = settings.llm_max_retries
        settings.llm_api_key = "test-secret-key"
        settings.llm_max_retries = 0

    def tearDown(self):
        settings.llm_api_key = self.original_key
        settings.llm_max_retries = self.original_retries

    async def test_valid_json_is_validated(self):
        data = {
            "显性需求": ["提升效率"], "隐性痛点": ["人工汇总"], "建设期望": ["统一入口"],
            "关注事项": ["安全"], "待确认问题": ["预算？"], "原文依据": ["提升效率"],
        }
        client = FakeClient([completion(json.dumps(data, ensure_ascii=False))])
        result = await call_llm("输出需求", {"communication": "提升效率"}, RequirementsOutput, data, client)
        self.assertEqual(result.data, data)
        sent = client.calls[0][1]["json"]
        self.assertEqual(sent["model"], settings.llm_model)
        self.assertEqual(sent["thinking"], {"type": "disabled"})
        self.assertEqual(sent["response_format"], {"type": "json_object"})

    async def test_empty_content_retries_twice_then_fails(self):
        settings.llm_max_retries = 2
        client = FakeClient([completion(""), completion(""), completion("")])
        with patch("app.services.agent.asyncio.sleep", new=AsyncMock()):
            with self.assertRaisesRegex(LLMCallError, "空内容"):
                await call_llm("测试", {}, ConnectionTestOutput, {"status": "ok"}, client)
        self.assertEqual(len(client.calls), 3)

    async def test_invalid_json_fails_schema_validation(self):
        client = FakeClient([completion("not-json")])
        with self.assertRaisesRegex(LLMCallError, "结构校验"):
            await call_llm("测试", {}, ConnectionTestOutput, {"status": "ok"}, client)

    async def test_auth_failure_is_safe_and_not_retried(self):
        client = FakeClient([response(401, {"error": {"message": "test-secret-key"}})])
        with self.assertRaises(LLMCallError) as caught:
            await call_llm("测试", {}, ConnectionTestOutput, {"status": "ok"}, client)
        self.assertIn("鉴权失败", str(caught.exception))
        self.assertNotIn("test-secret-key", str(caught.exception))
        self.assertEqual(len(client.calls), 1)

    async def test_rate_limit_is_retried(self):
        settings.llm_max_retries = 2
        client = FakeClient([response(429, {}), response(429, {}), response(429, {})])
        with patch("app.services.agent.asyncio.sleep", new=AsyncMock()):
            with self.assertRaisesRegex(LLMCallError, "频繁"):
                await call_llm("测试", {}, ConnectionTestOutput, {"status": "ok"}, client)
        self.assertEqual(len(client.calls), 3)

    async def test_timeout_is_retried(self):
        settings.llm_max_retries = 1
        timeout = httpx.ReadTimeout("timeout", request=httpx.Request("POST", "https://api.deepseek.com/chat/completions"))
        client = FakeClient([timeout, timeout])
        with patch("app.services.agent.asyncio.sleep", new=AsyncMock()):
            with self.assertRaisesRegex(LLMCallError, "超时"):
                await call_llm("测试", {}, ConnectionTestOutput, {"status": "ok"}, client)
        self.assertEqual(len(client.calls), 2)


if __name__ == "__main__":
    unittest.main()
