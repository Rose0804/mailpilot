# MailPilot

MailPilot 是一个本地优先的 Agentic 邮箱工作台，帮助用户理解邮件、检索附件、生成回复草稿，并在明确确认后执行高风险操作。

## 产品目标

- 聚合和区分多个邮箱账号。
- 对邮件正文和附件建立本地索引。
- 支持自然语言搜索、摘要和结构化信息提取。
- 从跨账号邮件中提取事件、截止日期和承诺，生成可解释的时间表。
- 将事件编排为带来源、账号和依赖关系的任务。
- 让 Agent 可以创建草稿、回复和执行邮箱操作。
- 对发送、删除、批量移动等操作提供可审计的人工确认。

## 当前状态

当前已完成桌面端邮箱工作台 MVP、Apple Mail 只读连接器、本地 SQLite/FTS5 索引、全量账号同步、邮件与附件只读 MCP Server、附件文本索引、本地 API，以及以 Pi Agent Core 为默认运行时的会话链路。现在 Agent 还可以把邮件事实写入结构化事件层，跨账号创建带来源和依赖关系的任务，并生成确定性的时间表和冲突视图。DSH 保留为可选兼容运行时。桌面端可以通过本地 API 读取真实索引、排程和 Agent 审计事件；写操作和 Mail.app 附件自动抓取仍未接入。

## 技术路线

- 桌面应用：Tauri 2（Rust 工具链已安装）
- 前端：React、TypeScript
- 本地核心：Rust
- 数据库：SQLite、FTS5
- Agent Runtime：Pi Agent Core 默认运行时，DSH 兼容适配层
- 能力连接：Model Context Protocol
- macOS 邮箱：Apple Mail Connector
- 凭据存储：macOS Keychain

## 目录结构

```text
mailpilot/
├── apps/
│   └── desktop/                 # 桌面端应用
├── packages/
│   ├── agent-runtime/           # Agent Runtime 适配层
│   ├── apple-mail-connector/    # macOS Mail.app 连接器
│   ├── database/                # SQLite 数据库与迁移
│   ├── document-indexer/        # 附件解析、分块和索引
│   ├── domain/                  # 领域模型与跨层契约
│   ├── mcp-server/              # MailPilot MCP Server
│   ├── policy/                  # 权限、审批和安全策略
│   ├── preview/                 # 附件预览与缩略图
│   ├── search/                  # 全文检索和语义检索
│   └── sync/                    # 邮件同步与游标管理
├── skills/                      # Agent 工作流定义
├── docs/                        # 中文产品与工程文档
└── scripts/                     # 本地开发与检查脚本
```

## 安全原则

1. 邮件正文、附件和网页内容都视为不可信数据。
2. 发送、删除和批量变更默认需要人工确认。
3. 每个操作必须明确指定账号、邮箱和消息标识。
4. 密钥只进入 macOS Keychain，不写入配置文件或数据库。
5. Agent 轨迹只记录可审计的工具步骤，不保存隐式思维链。

详细说明见：

- [系统架构](docs/系统架构.md)
- [数据模型](docs/数据模型.md)
- [MCP 工具设计](docs/MCP工具设计.md)
- [安全与审批](docs/安全与审批.md)
- [开发路线](docs/开发路线.md)
- [贡献指南](CONTRIBUTING.md)

## 本地开发

需要 Node.js 22.19.0 或更高版本、pnpm 10，以及通过 rustup 安装的 Rust stable 工具链。

```bash
pnpm install
pnpm --filter @mailpilot/desktop dev
```

要启动 Tauri 2 原生壳和本地 API：

```bash
pnpm tauri:dev
```

如果终端尚未加载 Rust：

```bash
source "$HOME/.cargo/env"
```

首次使用真实 Apple Mail 数据时，先同步本机 Mail.app：

```bash
pnpm --filter @mailpilot/sync sync
```

然后启动只读 MCP Server：

```bash
pnpm --filter @mailpilot/mcp-server exec tsx src/cli.ts
```

MCP Server 通过 stdio 提供账号、邮箱、邮件和附件查询工具、事件抽取和任务编排工具，以及 `mailpilot://message/...`、`mailpilot://attachment/...` 资源。桌面端通过本地 API 读取同一份 SQLite 索引和排程视图；附件检查器的打开按钮会访问受控的本地文本预览接口。

启动本地 API 后，桌面端默认访问 `http://127.0.0.1:3100`。默认 Agent Runtime 是 Pi，使用 `DEEPSEEK_API_KEY` 和 `MAILPILOT_PI_MODEL`。如果需要兼容 DSH，设置 `MAILPILOT_AGENT_RUNTIME=dsh` 和 `MAILPILOT_DSH_COMMAND=dsh`；API 会为 DSH 生成隔离的 `DSH_HOME`、SDK profile patch，并将 MailPilot MCP 挂载到 DSH。

检查命令：

```bash
pnpm -r lint
pnpm -r test
pnpm --filter @mailpilot/desktop build
```

## 当前边界

- 当前桌面端 UI 已接入本地产品 API；只有 API 连接失败时才回退到示例数据，空索引会显示真实空状态。
- 事件和任务已经接入 MCP、Pi 原生工具、本地 API 和桌面端排程视图；事件证据必须来自已索引邮件，任务依赖不能形成循环。
- Tauri 2 原生壳已初始化；生产打包仍需要完整 Cargo 网络缓存、Apple 签名和自动化权限配置。
- 本地附件索引器已支持 PDF、DOCX、XLSX 和文本文件；Apple Mail 连接器当前只读邮件头和正文，尚未自动提取 Mail.app 附件二进制。
- “创建草稿”是产品交互演示，不会向 Mail.app 写入内容。
- 当前时间表是本地确定性派生视图，不会自动写入系统日历；事件时间不确定时不会由 MailPilot 猜测。
- 发送、回复、删除和批量移动的审批策略已定义，但执行连接器尚未接入。
- Pi 默认运行时会直接使用 MailPilot 的 Pi 原生邮箱工具；MCP Server 仍作为外部 Agent 和 DSH 的标准能力接口。
- Agent Session 元数据和可审计事件写入数据库目录下的 `agent-sessions/`；Pi 当前 transcript 由进程内 Agent 持有，跨进程恢复仍需后续接入 Pi durable session。
- DSH 适配层只有在本机安装并配置 `dsh` 命令后才会启用；没有 Agent Runtime 时，邮件查询链路仍可独立使用。

## 开发节奏

每个功能阶段使用一个独立分支和 Conventional Commits。提交前必须从 Git 历史和仓库文档回顾上下文，并通过 lint、test 和 build 检查。

## 许可证

许可证将在首个可运行版本前确定。
