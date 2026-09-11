import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from docx import Document

from app.services.exporter import export_docx, export_pdf


class ExporterTests(unittest.TestCase):
    def setUp(self):
        self.artifact = SimpleNamespace(
            type=SimpleNamespace(value="research"),
            title="客户摸底",
            content={
                "客户": "示例企业",
                "结构化档案": [{
                    "key": "enterprise_nature",
                    "label": "企业性质",
                    "value": "国有企业",
                    "confidence": "公开来源",
                    "status": "已核实",
                    "source_url": "https://example.com",
                    "sources": [{"title": "公开来源", "url": "https://example.com"}],
                }],
                "潜在信息化方向": ["云网升级"],
                "待补充": ["企业规模"],
            },
            citations=[{"title": "公开来源", "url": "https://example.com"}],
        )

    def test_word_uses_human_readable_research_table_without_internal_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "research.docx"
            export_docx(path, "示例企业", [self.artifact])
            document = Document(path)
            visible = "\n".join(
                [paragraph.text for paragraph in document.paragraphs]
                + [cell.text for table in document.tables for row in table.rows for cell in row.cells]
            )
        self.assertIn("企业性质", visible)
        self.assertIn("国有企业", visible)
        self.assertIn("已核实", visible)
        for internal_key in ("enterprise_nature", "source_url", "sources", "label", "value"):
            self.assertNotIn(internal_key, visible)

    def test_pdf_accepts_enriched_research_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "research.pdf"
            export_pdf(path, "示例企业", [self.artifact])
            self.assertTrue(path.read_bytes().startswith(b"%PDF"))
            self.assertGreater(path.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
