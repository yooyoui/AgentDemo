import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app, settings
from app.models import KnowledgeDocument


class KnowledgeDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage_dir = Path(self.temp_dir.name) / "uploads"
        self.storage_dir.mkdir()
        self.original_storage_dir = settings.storage_dir
        settings.storage_dir = self.storage_dir

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
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)
        settings.storage_dir = self.original_storage_dir
        self.temp_dir.cleanup()

    def create_document(self, path: Path) -> str:
        with self.test_session() as db:
            document = KnowledgeDocument(
                filename=path.name,
                category="产品",
                version="1.0",
                path=str(path),
                content="测试知识库内容",
                chunks=["测试知识库内容"],
            )
            db.add(document)
            db.commit()
            return document.id

    def document_exists(self, document_id: str) -> bool:
        with self.test_session() as db:
            return db.get(KnowledgeDocument, document_id) is not None

    def test_delete_removes_database_record_and_uploaded_file(self):
        path = self.storage_dir / "product.txt"
        path.write_text("产品资料", encoding="utf-8")
        document_id = self.create_document(path)

        response = self.client.delete(f"/api/knowledge/{document_id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(path.exists())
        self.assertFalse(self.document_exists(document_id))

    def test_delete_succeeds_when_uploaded_file_is_already_missing(self):
        path = self.storage_dir / "missing.txt"
        document_id = self.create_document(path)

        response = self.client.delete(f"/api/knowledge/{document_id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(self.document_exists(document_id))

    def test_delete_unknown_document_returns_not_found(self):
        response = self.client.delete("/api/knowledge/not-found")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "知识库资料不存在")

    def test_delete_rejects_path_outside_storage_directory(self):
        outside_path = Path(self.temp_dir.name) / "outside.txt"
        outside_path.write_text("不得删除", encoding="utf-8")
        document_id = self.create_document(outside_path)

        response = self.client.delete(f"/api/knowledge/{document_id}")

        self.assertEqual(response.status_code, 409)
        self.assertTrue(outside_path.exists())
        self.assertTrue(self.document_exists(document_id))


if __name__ == "__main__":
    unittest.main()
