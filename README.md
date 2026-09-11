# 政企拜访助手

面向政企客户经理和解决方案经理的拜访前准备智能体 MVP。系统把客户摸底、需求拆解、移动能力匹配、初步方案和拜访话术串成一条可审核、可追溯、可导出的工作流，目标是将单次拜访准备时间降低至少 60%。

> 当前版本不包含登录、角色和权限隔离，仅适合本地开发、受控内网、VPN 或临时演示环境。请勿将服务直接暴露到公网，也不要录入未经授权的真实客户敏感数据。

## 功能概览

- 客户摸底：整理客户基础信息和公开资料，外部事实保留来源与采集时间。
- 需求拆解：从沟通记录中提取显性需求、隐性痛点、建设期望、关注事项和待确认问题。
- 能力匹配：仅基于内部知识库匹配产品、云业务、专线、行业方案、服务能力和案例。
- 初步方案：生成客户现状、建设目标、方案组合、建设思路、预期价值与风险边界。
- 拜访话术：覆盖开场破冰、背景确认、需求深挖、方案讲解、异议处理和收尾跟进。
- 人工审核：五项内容逐项确认，编辑后自动恢复为待确认状态。
- 成果导出：全部确认后导出可编辑 Word 和排版后的 PDF。
- 提示词管理：按任务维护模板、版本和启停状态，启用版本用于后续生成。

## 系统架构

```mermaid
flowchart LR
    U[浏览器] --> F[Next.js 工作台]
    F --> A[FastAPI]
    A --> D[(PostgreSQL / SQLite)]
    A --> R[(Redis\n预留异步队列)]
    A --> O[(MinIO / 本地目录\n资料与导出文件)]
    A --> L[DeepSeek API]
    A --> T[Tavily 公开检索]
    A --> K[内部知识库检索]
    K --> D
```

当前 MVP 默认使用 FastAPI `BackgroundTasks` 和本地文件目录；Redis、MinIO 与 pgvector 已在基础设施配置中预留，尚未完整替换本地实现。

### 智能体执行流程

```mermaid
flowchart LR
    I[输入校验] --> P[公开信息检索]
    P --> K[内部知识检索]
    K --> S[结构化分析]
    S --> C[引用与边界校验]
    C --> G[生成五项草稿]
    G --> H[人工逐项确认]
    H --> E[Word / PDF 导出]
```

网页、附件和沟通记录始终作为待分析数据，其中出现的指令不能覆盖系统规则或触发外部操作。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Next.js 15、React 19、TypeScript、Lucide Icons |
| 后端 | Python 3.12、FastAPI、SQLAlchemy、Pydantic |
| 大模型 | DeepSeek OpenAI-compatible API，默认 `deepseek-v4-flash` |
| 公开检索 | Tavily，可选 |
| 数据 | PostgreSQL 16 + pgvector；本地开发可使用 SQLite |
| 基础设施 | Redis 7、MinIO、Docker Compose |
| 文档处理 | pypdf、python-docx、python-pptx、openpyxl、ReportLab |

## 目录结构

```text
AgentDemo/
├─ backend/
│  ├─ app/
│  │  ├─ main.py              # API 与五步生成编排
│  │  ├─ models.py            # 数据模型
│  │  ├─ schemas.py           # API 输入输出结构
│  │  └─ services/
│  │     ├─ agent.py          # DeepSeek、检索与安全处理
│  │     ├─ outputs.py        # 五类模型输出校验
│  │     ├─ documents.py      # PDF/Word/PPT/Excel 文本提取
│  │     └─ exporter.py       # Word/PDF 导出
│  ├─ tests/
│  └─ requirements.txt
├─ frontend/
│  ├─ app/                    # 页面与样式
│  ├─ lib/api.ts              # 前端 API 客户端
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ .github/workflows/ci.yml
├─ .env.example
├─ docker-compose.yml
└─ README.md
```

运行时数据库、上传文件、导出成果、缓存、`.env` 和内部产品文档均被 Git 忽略。

## 环境要求

- Python 3.12
- Node.js 22 LTS
- pnpm 9.15.4（通过 Corepack 安装）
- 可选：Docker Desktop / Docker Engine + Compose
- 可选：DeepSeek API Key、Tavily API Key

## 快速启动：SQLite 演示模式

不需要 Docker 或外部 API，适合首次体验和界面开发。

### 1. 获取代码和配置

```bash
git clone https://github.com/yooyoui/AgentDemo.git
cd AgentDemo
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

把 `.env` 中的数据库地址改为：

```env
DATABASE_URL=sqlite:///./backend/data/visit_assistant.db
```

保持 `LLM_API_KEY` 和 `TAVILY_API_KEY` 为空时，系统使用可复现的演示规则。

### 2. 启动后端

Windows PowerShell：

```powershell
py -3.12 -m venv backend/.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

macOS / Linux：

```bash
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

后端入口：

- 健康检查：<http://127.0.0.1:8000/api/health>
- OpenAPI 文档：<http://127.0.0.1:8000/api/docs>

### 3. 启动前端

打开另一个终端：

```bash
cd frontend
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm dev --port 3001
```

访问 <http://localhost:3001>。

## 完整环境：PostgreSQL、Redis 与 MinIO

复制 `.env.example` 后保留默认 PostgreSQL 地址，然后启动基础服务：

```bash
docker compose up -d postgres redis minio
```

| 服务 | 地址 |
| --- | --- |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| MinIO API | `localhost:9000` |
| MinIO Console | <http://localhost:9001> |

再按前述命令启动后端和前端。Docker Compose 中的默认凭据仅用于本地开发，部署前必须替换。

## 接入 DeepSeek 与公开检索

在本地 `.env` 中填写配置，不要向仓库提交真实密钥：

```env
LLM_API_KEY=你的_DeepSeek_API_Key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
LLM_TIMEOUT_SECONDS=90
LLM_MAX_TOKENS=4096
LLM_MAX_RETRIES=2

TAVILY_API_KEY=你的_Tavily_API_Key
```

修改后重启后端。检查模型配置：

```bash
curl http://127.0.0.1:8000/api/health
curl -X POST http://127.0.0.1:8000/api/model/test
```

PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/model/test
```

模型调用使用 JSON Output、结构校验、非思考模式、超时和重试。配置了 Key 后如果调用失败，生成任务会明确失败，不会静默降级为演示内容。

## 主要 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 服务、模型与公开检索状态 |
| `POST` | `/api/model/test` | DeepSeek 连通性测试 |
| `GET/POST` | `/api/customers` | 查询或创建客户 |
| `POST` | `/api/knowledge` | 上传并索引内部资料 |
| `GET/PUT` | `/api/prompts`、`/api/prompts/{task_type}` | 提示词管理 |
| `POST` | `/api/customers/{id}/run-all` | 异步生成整套拜访材料 |
| `GET` | `/api/tasks/{id}` | 查询生成进度和错误 |
| `GET/PUT` | `/api/artifacts`、`/api/artifacts/{id}` | 查询和修改草稿 |
| `POST` | `/api/artifacts/{id}/confirm` | 人工确认单项材料 |
| `POST` | `/api/customers/{id}/export/{docx\|pdf}` | 导出确认后的材料 |

知识库支持 `.pdf`、`.docx`、`.pptx`、`.xlsx`、`.txt` 和 `.md`，单文件默认不超过 15 MB。

## 测试与构建

Windows 后端测试：

```powershell
backend\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

macOS / Linux 后端测试：

```bash
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

前端检查：

```bash
cd frontend
pnpm exec tsc --noEmit --incremental false
pnpm build
```

Pull Request 会通过 GitHub Actions 自动执行后端测试、前端类型检查和生产构建。CI 不使用真实 DeepSeek 或 Tavily Key。

## 协作开发流程

1. 同步最新 `main`，创建功能分支：`git switch -c feature/简短功能名`。
2. 一次提交只解决一个清晰问题，提交信息使用 `feat:`、`fix:`、`docs:`、`test:` 或 `chore:` 前缀。
3. 本地运行相关测试，确认没有提交 `.env`、数据库、上传资料或导出文件。
4. 推送分支并创建 Pull Request，说明背景、主要改动、验证方式和界面变化。
5. 至少完成一次代码评审并等待 CI 通过后再合并到 `main`。
6. 不直接在 `main` 上开发，不使用强制推送改写共享历史。

建议 Pull Request 描述包含：

- 改动解决的问题和主要实现。
- 接口、数据或兼容性变化。
- 手工验证步骤与自动测试结果。
- 安全和数据影响。
- 涉及界面时附前后对比截图。

## 安全约束

- 当前所有访问者共享同一工作空间，没有用户级数据隔离。
- `.env`、API Key、客户数据库、原始附件和导出成果禁止提交到 Git。
- 大模型不能直接访问互联网；公开资料仅由配置的检索服务获取。
- 能力推荐必须有内部资料依据；没有依据时明确返回暂无证据。
- 不生成未经确认的产品能力、案例、报价、工期或服务承诺。
- 上线公网或录入正式客户资料前，必须补充认证、权限、审计、密钥管理和下载地址过期机制。

## 已知限制与路线

- Redis 异步任务、MinIO 对象存储和 pgvector 向量检索尚未完整启用。
- 公开摸底依赖 Tavily；未配置时仅展示用户输入和待核实信息。
- 当前使用单一共享空间，不区分客户经理、解决方案经理和管理员。
- 暂不包含拜访后总结、CRM/OA 集成、招投标监控和行业资讯推送。
- 后续优先补充登录权限、操作审计、正式向量检索、任务队列和真实案例评测。

## 常见问题

### 页面显示“大模型演示模式”

确认 `.env` 中已填写 `LLM_API_KEY`，保存后重启后端，再调用 `/api/model/test`。

### 前端无法访问后端

确认后端监听 `8000` 端口。前后端分开部署时设置 `NEXT_PUBLIC_API_URL`；本地开发默认通过 Next.js 同源代理访问后端。

### 端口被占用

停止旧开发进程，或为 `uvicorn`、`pnpm dev` 指定其他端口；变更前端端口时同步检查 `CORS_ORIGINS`。

### Windows 出现 `.next/trace` 的 `EPERM`

通常是旧 Next.js 进程仍占用缓存文件。只结束该项目对应的旧 Node 进程后重新执行 `pnpm dev --port 3001`，不要批量结束其他 Node 应用。

### 无法导出 Word 或 PDF

必须先逐项确认五份材料。修改任一草稿后，该项会重新变为待确认状态。

## 许可证

本仓库当前未授予开源许可证，保留全部权利。需要对外分发或开源前，请先明确许可证与内部资料边界。
