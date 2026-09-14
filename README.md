# MailPilot

MailPilot 是一个本地优先的 Agentic 邮箱工作台，帮助用户理解邮件、检索附件、生成回复草稿，并在明确确认后执行高风险操作。

## 产品目标

- 聚合和区分多个邮箱账号。
- 对邮件正文和附件建立本地索引。
- 支持自然语言搜索、摘要和结构化信息提取。
- 让 Agent 可以创建草稿、回复和执行邮箱操作。
- 对发送、删除、批量移动等操作提供可审计的人工确认。

## 当前状态

当前已完成桌面端邮箱工作台 MVP、示例数据交互、领域契约和基础审批策略。真实 Apple Mail、MCP 和附件索引连接器将在后续阶段接入。

## 技术路线

- 桌面应用：Tauri 2
- 前端：React、TypeScript
- 本地核心：Rust
- 数据库：SQLite、FTS5
- Agent Runtime：DeepSeek Harness 适配层
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

需要 Node.js 22 或更高版本，以及 pnpm 10。

```bash
pnpm install
pnpm --filter @mailpilot/desktop dev
```

打开终端输出的本地地址即可预览桌面端工作台。当前界面使用示例数据，搜索、账号空间筛选和创建草稿提示可以直接交互。

检查命令：

```bash
pnpm -r lint
pnpm -r test
pnpm --filter @mailpilot/desktop build
```

## 当前边界

- 当前桌面端尚未连接真实邮箱账号。
- 当前附件预览使用示例数据。
- “创建草稿”是产品交互演示，不会向 Mail.app 发送内容。
- 发送、删除和批量移动的审批策略已定义，但执行连接器尚未接入。

## 开发节奏

每个功能阶段使用一个独立分支和 Conventional Commits。提交前必须从 Git 历史和仓库文档回顾上下文，并通过 lint、test 和 build 检查。

## 许可证

许可证将在首个可运行版本前确定。
