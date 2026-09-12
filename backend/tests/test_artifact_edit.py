import unittest

from app.services.artifact_edit import ArtifactEditError, SCRIPT_STAGES, prepare_artifact_update


class ArtifactEditTests(unittest.TestCase):
    def research(self, status="待补充", confidence="待补充", value="待补充"):
        return {
            "客户": "示例企业",
            "结构化档案": [{
                "key": "enterprise_nature",
                "label": "企业性质",
                "value": value,
                "status": status,
                "confidence": confidence,
                "source_url": "https://example.com",
                "sources": [{"title": "企业官网", "url": "https://example.com"}],
            }],
            "潜在信息化方向": [],
            "待补充": ["企业性质", "自由待办"],
        }

    def test_pending_fact_becomes_manual_supplement_and_preserves_history(self):
        current = self.research()
        incoming = self.research(value="民营企业")
        updated = prepare_artifact_update("research", current, incoming)
        fact = updated["结构化档案"][0]
        self.assertEqual(fact["status"], "已补充")
        self.assertEqual(fact["confidence"], "人工补充")
        self.assertIsNone(fact["source_url"])
        self.assertEqual(fact["sources"], [])
        self.assertEqual(fact["edit_history"][0]["value"], "待补充")
        self.assertEqual(fact["edit_history"][0]["sources"][0]["title"], "企业官网")
        self.assertEqual(updated["待补充"], ["自由待办"])

    def test_verified_and_user_facts_get_distinct_statuses_and_repeat_history(self):
        current = self.research("已核实", "公开来源", "国有企业")
        first = self.research("已核实", "公开来源", "民营企业")
        first_updated = prepare_artifact_update("research", current, first)
        self.assertEqual(first_updated["结构化档案"][0]["status"], "核实后修改")
        second = {**first_updated, "结构化档案": [{**first_updated["结构化档案"][0], "value": "有限责任公司"}]}
        second_updated = prepare_artifact_update("research", first_updated, second)
        self.assertEqual(len(second_updated["结构化档案"][0]["edit_history"]), 2)

        user_current = self.research("用户提供", "用户提供", "制造业")
        user_incoming = self.research("用户提供", "用户提供", "装备制造")
        self.assertEqual(
            prepare_artifact_update("research", user_current, user_incoming)["结构化档案"][0]["status"],
            "用户修改",
        )

    def test_capability_evidence_is_read_only(self):
        current = {"匹配结果": [{"能力": "专线", "类别": "产品", "匹配理由": "匹配", "适用条件": "勘查", "引用": "原文", "document_id": "1"}], "提示": None}
        changed = {"匹配结果": [{**current["匹配结果"][0], "引用": "伪造原文"}], "提示": None}
        with self.assertRaises(ArtifactEditError):
            prepare_artifact_update("capabilities", current, changed)
        editable = {"匹配结果": [{**current["匹配结果"][0], "匹配理由": "新的理由"}], "提示": None}
        self.assertEqual(prepare_artifact_update("capabilities", current, editable)["匹配结果"][0]["匹配理由"], "新的理由")

    def test_solution_only_accepts_matched_capabilities(self):
        incoming = {"客户现状": "现状", "建设目标": [], "方案组合": ["不存在能力"], "建设思路": [], "预期价值": [], "风险边界": []}
        with self.assertRaises(ArtifactEditError):
            prepare_artifact_update("solution", {}, incoming, capability_names={"专线"})

    def test_script_keeps_six_stages_and_solution_boundaries(self):
        incoming = {
            "拜访设置": {"类型": "首次拜访", "客户角色": "负责人", "表达风格": "务实"},
            "阶段": [{"名称": name, "目标": "确认", "推荐表达": "请介绍", "问题": []} for name in SCRIPT_STAGES],
            "禁止承诺": ["额外承诺"],
        }
        updated = prepare_artifact_update("script", {}, incoming, solution_boundaries=["报价需确认"])
        self.assertEqual(updated["禁止承诺"], ["报价需确认", "额外承诺"])
        incoming["阶段"].reverse()
        with self.assertRaises(ArtifactEditError):
            prepare_artifact_update("script", {}, incoming)


if __name__ == "__main__":
    unittest.main()
