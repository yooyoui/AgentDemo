import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app, settings
from app.models import Artifact, ArtifactType, Customer, ExportArtifact, GenerationTask, WorkspaceOption


class CustomerAndOptionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.export_dir = Path(self.temp_dir.name) / "exports"
        self.export_dir.mkdir()
        self.original_export_dir = settings.export_dir
        settings.export_dir = self.export_dir
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.test_session = sessionmaker(bind=engine, expire_on_commit=False)

        def override_db():
            with self.test_session() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        settings.export_dir = self.original_export_dir
        self.temp_dir.cleanup()

    def create_customer(self, task_status="completed", export_path=None):
        with self.test_session() as db:
            customer = Customer(name="示例客户", industry="制造", nature="民营", region="重庆")
            db.add(customer)
            db.flush()
            db.add(Artifact(customer_id=customer.id, type=ArtifactType.requirements, title="需求", content={}))
            db.add(GenerationTask(customer_id=customer.id, task_type="run-all", status=task_status))
            if export_path is not None:
                db.add(ExportArtifact(customer_id=customer.id, format="pdf", path=str(export_path)))
            db.commit()
            return customer.id

    def delete(self, customer_id, name="示例客户"):
        return self.client.request("DELETE", f"/api/customers/{customer_id}", json={"confirmation_name": name})

    def test_customer_delete_removes_relations_and_valid_export(self):
        path = self.export_dir / "result.pdf"
        path.write_bytes(b"pdf")
        customer_id = self.create_customer(export_path=path)
        response = self.delete(customer_id)
        self.assertEqual(response.status_code, 204)
        self.assertFalse(path.exists())
        with self.test_session() as db:
            self.assertIsNone(db.get(Customer, customer_id))
            self.assertEqual(db.query(Artifact).count(), 0)
            self.assertEqual(db.query(GenerationTask).count(), 0)
            self.assertEqual(db.query(ExportArtifact).count(), 0)

    def test_customer_delete_guards_name_active_task_and_bad_path(self):
        customer_id = self.create_customer()
        self.assertEqual(self.delete(customer_id, "错误名称").status_code, 409)
        active_id = self.create_customer(task_status="running")
        self.assertEqual(self.delete(active_id).status_code, 409)
        outside = Path(self.temp_dir.name) / "outside.pdf"
        outside.write_bytes(b"keep")
        bad_id = self.create_customer(export_path=outside)
        self.assertEqual(self.delete(bad_id).status_code, 409)
        self.assertTrue(outside.exists())

    def test_missing_export_file_does_not_block_delete(self):
        customer_id = self.create_customer(export_path=self.export_dir / "missing.pdf")
        self.assertEqual(self.delete(customer_id).status_code, 204)

    def test_workspace_options_create_list_delete_and_protect_builtin(self):
        with self.test_session() as db:
            builtin = WorkspaceOption(kind="style", label="专业务实", is_builtin=True, sort_order=0)
            db.add(builtin)
            db.commit()
            builtin_id = builtin.id
        created = self.client.post("/api/workspace-options", json={"kind": "style", "label": "  温和简洁  "})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["label"], "温和简洁")
        self.assertTrue(any(item["label"] == "温和简洁" for item in self.client.get("/api/workspace-options").json()))
        self.assertEqual(self.client.post("/api/workspace-options", json={"kind": "style", "label": "温和简洁"}).status_code, 409)
        self.assertEqual(self.client.delete(f"/api/workspace-options/{builtin_id}").status_code, 409)
        self.assertEqual(self.client.delete(f"/api/workspace-options/{created.json()['id']}").status_code, 204)
        self.assertEqual(self.client.delete("/api/workspace-options/missing").status_code, 404)
        self.assertEqual(self.client.post("/api/workspace-options", json={"kind": "bad", "label": "X"}).status_code, 422)

    def test_artifact_update_increments_version_resets_confirmation_and_audits_fact(self):
        with self.test_session() as db:
            customer = Customer(name="档案编辑客户", industry="制造", nature="民营", region="重庆")
            db.add(customer)
            db.flush()
            artifact = Artifact(
                customer_id=customer.id,
                type=ArtifactType.research,
                title="客户摸底",
                version=3,
                confirmed=True,
                content={
                    "客户": customer.name,
                    "结构化档案": [{
                        "key": "enterprise_nature",
                        "label": "企业性质",
                        "value": "待补充",
                        "status": "待补充",
                        "confidence": "待补充",
                        "source_url": None,
                        "sources": [],
                    }],
                    "潜在信息化方向": [],
                    "待补充": ["企业性质"],
                },
            )
            db.add(artifact)
            db.commit()
            artifact_id = artifact.id
            content = dict(artifact.content)
            content["结构化档案"] = [{**artifact.content["结构化档案"][0], "value": "有限责任公司"}]
        response = self.client.put(f"/api/artifacts/{artifact_id}", json={"content": content})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["version"], 4)
        self.assertFalse(response.json()["confirmed"])
        fact = response.json()["content"]["结构化档案"][0]
        self.assertEqual(fact["status"], "已补充")
        self.assertEqual(fact["edit_history"][0]["value"], "待补充")


if __name__ == "__main__":
    unittest.main()
