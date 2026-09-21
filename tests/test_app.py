from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.main import app


class ApplicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

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


if __name__ == "__main__":
    unittest.main()
