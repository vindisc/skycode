# ZhikunCode 项目指南

## 项目概览

ZhikunCode 是一个自托管的 AI 编程工作台。仓库由多个服务组成，应在实际负责该功能的服务中修改代码，并使用该服务自身的脚本，而不是假定仓库根目录存在统一构建命令。

- `backend/`：Java 21、Spring Boot 3.4.13、Maven；提供 REST/WebSocket 应用和 SQLite 持久化。
- `frontend/`：React 18 + TypeScript、Vite；浏览器界面，使用 Vitest 和 Playwright。
- `python-service/`：Python 3.11–3.12、FastAPI、pytest；分析与能力服务。
- `configuration/`、`scripts/`、`docs/`：部署配置、实用脚本和文档。
- 仓库根目录包含 Docker 构建与部署文件。

## 构建、测试与代码检查

以下命令应在相应服务目录中运行。

### 后端（`backend/`）

- 构建/打包：`./mvnw package`
- 测试：`./mvnw test`
- 覆盖率检查：`./mvnw -q verify -Pcoverage`
- 当前检查过的 Maven 配置中未发现后端 lint 命令。

### 前端（`frontend/`）

- 启动开发服务器：`npm run dev`
- 构建（包含 TypeScript 类型检查）：`npm run build`
- 代码检查：`npm run lint`
- 单元测试：`npm run test:run`（监听模式：`npm test`）
- 单元测试覆盖率：`npm run test:coverage`
- 浏览器端到端测试：`npm run test:e2e`
- 主题浏览器回归测试：`npm run test:theme-regression`

### Python 服务（`python-service/`）

- 测试：`pytest`
- 运行覆盖率检查时要求至少 70% 覆盖率；pytest 配置的测试目录为 `tests/`。
- 当前检查过的 Python 项目配置中未发现 lint 命令。

### 部署

- 在仓库根目录构建并启动 Docker Compose 服务：`docker compose up -d --build`
- 没有文档化的全仓统一 lint/test 命令；应针对修改的服务运行相应检查。

以上命令依据项目配置或文档整理；执行前可能需要安装依赖或准备运行环境。命令列在此处不代表已经运行，报告验证结果时应说明实际执行的检查及其结果。

## 项目约定

- 遵循 `.editorconfig`：UTF-8、LF 换行、文件末尾保留换行符、使用空格缩进；默认 4 个空格，JS/TS/JSON/YAML/CSS/SCSS/XML/HTML 使用 2 个空格；Makefile 使用 Tab。Markdown 文件允许保留行尾空格。
- 前端使用 ES Modules。沿用现有 React 函数组件、TypeScript、Vite 路径别名和 ESLint 规则。启用了推荐的 React Hooks 规则；TypeScript 未使用变量会报错，但以下划线开头的变量除外。
- 后端按功能/包组织在 `com.aicodeassistant` 下。参考相邻类中的 Java 和 Spring 写法。测试位于 `backend/src/test/`。
- Python 源码位于 `python-service/src/`，测试位于 `python-service/tests/`；沿用现有 FastAPI/Pydantic 模式。
- 修改范围应限于相关服务。项目未配置的格式化工具、lint 工具或依赖不要随意引入。

## 开发工作建议

- 修改行为前先检查相邻实现和测试；在负责该行为的服务边界补充或更新测试。
- 谨慎处理配置和数据库迁移：后端 SQLite 迁移类位于 `backend/src/main/java/com/aicodeassistant/config/database/`，应沿用现有迁移约定。
- 不要因为命令写在本指南里就假定它已执行；应如实报告实际运行的检查及结果。
