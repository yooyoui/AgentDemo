import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.main import execute_flow
from app.models import Artifact, ArtifactType, Customer, GenerationTask


class FlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_incomplete_model_boundaries_are_restored_before_script_is_saved(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        test_session = sessionmaker(bind=engine, expire_on_commit=False)

        with test_session() as db:
            customer = Customer(name="示例制造企业", industry="制造业", nature="民营", region="重庆")
            db.add(customer)
            db.flush()
            task = GenerationTask(
                customer_id=customer.id,
                task_type="run-all",
                input_snapshot={"communication": "客户希望提升协同效率"},
                model="deepseek-v4-flash",
            )
            db.add(task)
            db.commit()
            customer_id = customer.id
            task_id = task.id

        research = {
            "客户": "示例制造企业",
            "结构化档案": [
                {"label": "所属行业", "value": "制造业", "confidence": "用户提供", "source_url": None}
            ],
            "潜在信息化方向": ["协同数字化"],
            "待补充": [],
        }
        requirements = {
            "显性需求": ["提升协同效率"],
            "隐性痛点": [],
            "建设期望": ["提升协同效率"],
            "关注事项": [],
            "待确认问题": [],
            "原文依据": ["客户希望提升协同效率"],
        }
        solution = {
            "客户现状": "当前协同效率有待提升。",
            "建设目标": ["提升协同效率"],
            "方案组合": [],
            "建设思路": ["先调研后验证"],
            "预期价值": ["提升效率"],
            "风险边界": ["不得承诺未经确认的报价", "具体工期需要进一步评估"],
        }
        script = {
            "拜访设置": {"类型": "首次拜访", "客户角色": "业务负责人", "表达风格": "专业务实"},
            "阶段": [],
            "禁止承诺": ["报价需确认", "不得承诺额外服务"],
        }
        results = [
            SimpleNamespace(data=requirements, latency_ms=1, attempts=1),
            SimpleNamespace(data=solution, latency_ms=1, attempts=1),
            SimpleNamespace(data=script, latency_ms=1, attempts=1),
        ]

        payload = {
            "communication": "客户希望提升协同效率",
            "visit_type": "首次拜访",
            "customer_role": "业务负责人",
            "style": "专业务实",
        }
        with (
            patch("app.main.SessionLocal", test_session),
            patch(
                "app.main.generate_customer_research",
                new=AsyncMock(return_value=(
                    research,
                    [],
                    {
                        "search_rounds": 1,
                        "source_count": 0,
                        "coverage_percent": 10,
                        "critical_field_coverage_percent": 25,
                        "entity_conflict": False,
                        "conflict_notes": [],
                    },
                    {"latency_ms": 1, "attempts": 1, "calls": 1},
                )),
            ),
            patch("app.main.call_llm", new=AsyncMock(side_effect=results)),
        ):
            await execute_flow(task_id, payload)

        with test_session() as db:
            saved_task = db.get(GenerationTask, task_id)
            saved_script = db.scalar(
                select(Artifact).where(
                    Artifact.customer_id == customer_id,
                    Artifact.type == ArtifactType.script,
                )
            )
            self.assertEqual(saved_task.status, "completed")
            self.assertEqual(saved_task.progress, 100)
            self.assertEqual(saved_task.error, "")
            self.assertEqual(saved_task.output["research"]["search_rounds"], 1)
            self.assertIsNotNone(saved_script)
            self.assertFalse(saved_script.confirmed)
            self.assertEqual(
                saved_script.content["禁止承诺"],
                [
                    "不得承诺未经确认的报价",
                    "具体工期需要进一步评估",
                    "报价需确认",
                    "不得承诺额外服务",
                ],
            )


if __name__ == "__main__":
    unittest.main()
