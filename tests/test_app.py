from __future__ import annotations

import unittest
import json
import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app import ai_service


class ApplicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def tearDown(self):
        ai_service.clear_runtime_config()

    def test_knowledge_counts_and_special_records(self):
        meta = self.client.get("/api/meta").json()
        self.assertEqual(meta["case_count"], 185)
        self.assertEqual(meta["readable_case_count"], 184)
        self.assertEqual(meta["institution_count"], 23)
        case_14 = self.client.get("/api/cases/014").json()
        self.assertIn("empty_source", case_14["risk_flags"])
        institution_12 = self.client.get("/api/institutions/012").json()
        self.assertIn("试行", institution_12["version_status"])
        institution_21 = self.client.get("/api/institutions/021").json()
        self.assertIn("mixed_versions", institution_21["risk_flags"])
        self.assertIn("2026-03-09", institution_21["version_status"])

    def test_search_relevance_and_unrelated_filter(self):
        result = self.client.get("/api/cases", params={"q": "监理拒签"}).json()["items"]
        self.assertTrue(result)
        self.assertEqual(result[0]["id"], "001")
        empty = self.client.get("/api/search", params={"q": "不存在的唯一词条xyz987"}).json()
        self.assertEqual(empty["cases"], [])
        self.assertEqual(empty["institutions"], [])

    def test_matter_persistence_citation_and_export_isolation(self):
        created = self.client.post(
            "/api/matters",
            json={"title": "测试结算纠纷", "project_name": "测试项目", "current_step": 1},
        ).json()
        matter_id = created["id"]
        payload = {
            **created,
            "title": "测试结算纠纷",
            "project_name": "测试项目",
            "stance": "总包",
            "counterparty": "分包单位",
            "stage": "协商中",
            "dispute_type": "结算审计",
            "amount": "100万至130万元",
            "current_step": 9,
            "sections": {
                "company": {
                    "position": "内部立场文本",
                    "message": "统一外部口径",
                    "spokesperson": "合同部负责人",
                    "concession": "内部让步底线",
                    "approvals": "报分管领导",
                    "internal_action": "内部整改文本",
                },
                "manual_citations": [
                    {"library_type": "项目合同", "doc_id": "专用条款12.1", "source_label": "结算程序约定"}
                ],
            },
        }
        updated = self.client.put(f"/api/matters/{matter_id}", json=payload).json()
        self.assertEqual(updated["sections"]["company"]["concession"], "内部让步底线")
        citation = {
            "library_type": "公司制度",
            "doc_id": "012",
            "title": "对下结算管理办法",
            "source_label": "【公司制度（拟定稿）】制度12号",
        }
        self.client.post(f"/api/matters/{matter_id}/citations", json=citation)
        restored = self.client.get(f"/api/matters/{matter_id}").json()
        self.assertEqual(restored["project_name"], "测试项目")
        self.assertEqual(len(restored["citations"]), 1)
        internal = self.client.post(f"/api/matters/{matter_id}/export", json={"audience": "internal"}).text
        external = self.client.post(f"/api/matters/{matter_id}/export", json={"audience": "external"}).text
        self.assertIn("内部让步底线", internal)
        self.assertNotIn("内部让步底线", external)
        self.assertNotIn("内部整改文本", external)
        self.assertIn("结算程序约定", external)
        self.client.delete(f"/api/matters/{matter_id}")

    def test_ai_disabled_status_and_missing_matter(self):
        with patch.dict(os.environ, {"DISPUTE_EXPERT_AI_API_KEY": ""}, clear=False):
            status = self.client.get("/api/ai/status").json()
            self.assertFalse(status["enabled"])
            matter = self.client.post("/api/matters", json={"title": "AI关闭测试"}).json()
            result = self.client.post("/api/ai/analyze", json={"matter_id": matter["id"], "task": "risk_summary"}).json()
            self.assertFalse(result["enabled"])
            self.client.delete(f"/api/matters/{matter['id']}")
        self.assertEqual(self.client.post("/api/ai/analyze", json={"matter_id": "missing", "task": "risk_summary"}).status_code, 404)

    def test_runtime_ai_config_does_not_expose_or_persist_key(self):
        secret = "sk-local-test-secret"
        with patch.dict(os.environ, {"DISPUTE_EXPERT_AI_API_KEY": ""}, clear=False):
            response = self.client.post("/api/ai/config", json={
                "api_key": secret,
                "model": "test-model",
                "base_url": "https://api.openai.com/v1/responses",
                "protocol": "responses",
                "provider": "OpenAI 官方",
            })
            self.assertEqual(response.status_code, 200)
            status = response.json()
            self.assertTrue(status["enabled"])
            self.assertEqual(status["model"], "test-model")
            self.assertEqual(status["source"], "session")
            self.assertEqual(status["connection_status"], "untested")
            self.assertEqual(status["protocol"], "responses")
            self.assertEqual(status["provider"], "OpenAI 官方")
            self.assertNotIn(secret, response.text)
            self.assertNotIn("api_key", response.text.lower())

            fetched = self.client.get("/api/ai/status")
            self.assertNotIn(secret, fetched.text)
            cleared = self.client.delete("/api/ai/config").json()
            self.assertFalse(cleared["enabled"])
            self.assertEqual(cleared["source"], "none")

            invalid = self.client.post("/api/ai/config", json={"api_key": "", "model": "test model"})
            self.assertEqual(invalid.status_code, 422)

            local_url = self.client.post("/api/ai/config", json={
                "api_key": secret,
                "model": "test-model",
                "base_url": "https://127.0.0.1/v1/chat/completions",
                "protocol": "chat_completions",
                "provider": "自定义",
            })
            self.assertEqual(local_url.status_code, 422)

    def test_ai_connection_check_tracks_success_and_failure(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps({"output_text": "OK"}).encode("utf-8")

        self.client.post("/api/ai/config", json={
            "api_key": "sk-test",
            "model": "test-model",
            "base_url": "https://api.openai.com/v1/responses",
            "protocol": "responses",
            "provider": "OpenAI 官方",
        })
        with patch.object(ai_service._http_opener, "open", return_value=Response()):
            result = self.client.post("/api/ai/test").json()
            self.assertEqual(result["connection_status"], "verified")
            self.assertNotIn("sk-test", json.dumps(result))

        from urllib.error import HTTPError
        with patch.object(ai_service._http_opener, "open", side_effect=HTTPError("url", 404, "not found", {}, None)):
            response = self.client.post("/api/ai/test")
            self.assertEqual(response.status_code, 502)
            status = self.client.get("/api/ai/status").json()
            self.assertEqual(status["connection_status"], "failed")
            self.assertIn("接口协议", status["connection_message"])

    def test_chat_completions_compatible_request_and_response(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self):
                return json.dumps({"choices": [{"message": {"content": "兼容接口正常"}}]}).encode("utf-8")

        matter = self.client.post("/api/matters", json={"title": "兼容接口测试"}).json()
        with patch.object(ai_service.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))]):
            configured = self.client.post("/api/ai/config", json={
                "api_key": "domestic-test-key",
                "model": "provider-model",
                "base_url": "https://api.example.com/v1/chat/completions",
                "protocol": "chat_completions",
                "provider": "兼容服务",
            })
        self.assertEqual(configured.status_code, 200)
        with patch.object(ai_service._http_opener, "open", return_value=Response()) as mocked:
            result = self.client.post("/api/ai/analyze", json={"matter_id": matter["id"], "task": "risk_summary"}).json()
            self.assertEqual(result["content"], "兼容接口正常")
            body = json.loads(mocked.call_args.args[0].data.decode("utf-8"))
            self.assertEqual(body["model"], "provider-model")
            self.assertEqual(body["messages"][0]["role"], "system")
            self.assertEqual(body["messages"][1]["role"], "user")
            self.assertIn("案件上下文", body["messages"][1]["content"])
            self.assertIn("max_tokens", body)
            self.assertNotIn("input", body)
        self.client.delete(f"/api/matters/{matter['id']}")

    def test_ai_request_uses_selected_citations_and_does_not_update_matter(self):
        matter = self.client.post("/api/matters", json={"title": "AI模拟测试"}).json()
        matter["sections"] = {"company": {"concession": "不能发送的内部底线"}, "gaps": [{"priority": "必须补", "item": "合同", "action": "补齐"}]}
        matter = self.client.put(f"/api/matters/{matter['id']}", json=matter).json()
        self.client.post(f"/api/matters/{matter['id']}/citations", json={"library_type": "案例", "doc_id": "001", "title": "案例一", "source_label": "行业经验素材"})
        self.client.post(f"/api/matters/{matter['id']}/citations", json={"library_type": "公司制度", "doc_id": "021", "title": "制度二十一", "source_label": "制度版本段"})

        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps({"output_text": "风险摘要草稿"}).encode("utf-8")

        with patch.dict(os.environ, {"DISPUTE_EXPERT_AI_API_KEY": "test-key", "DISPUTE_EXPERT_AI_MODEL": "test-model"}, clear=False):
            with patch.object(ai_service._http_opener, "open", return_value=Response()) as mocked:
                result = self.client.post(f"/api/ai/analyze", json={"matter_id": matter["id"], "task": "risk_summary", "selected_citations": ["case:001"]}).json()
                self.assertTrue(result["enabled"])
                self.assertEqual(result["content"], "风险摘要草稿")
                self.assertEqual([item["doc_id"] for item in result["citations"]], ["001"])
                body = json.loads(mocked.call_args.args[0].data.decode("utf-8"))
                self.assertIn("案件上下文", body["input"])
                self.assertNotIn("不能发送的内部底线", body["input"])
                self.assertEqual(body["model"], "test-model")
        restored = self.client.get(f"/api/matters/{matter['id']}").json()
        self.assertEqual(restored["sections"]["company"]["concession"], "不能发送的内部底线")
        self.client.delete(f"/api/matters/{matter['id']}")


if __name__ == "__main__":
    unittest.main()
