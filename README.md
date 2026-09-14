# MailPilot

MailPilot 是一个本地优先的 Agentic 邮箱工作台，帮助用户理解邮件、检索附件、生成回复草稿，并在明确确认后执行高风险操作。

## 产品目标

- 聚合和区分多个邮箱账号。
- 对邮件正文和附件建立本地索引。
- 支持自然语言搜索、摘要和结构化信息提取。
- 让 Agent 可以创建草稿、回复和执行邮箱操作。
- 对发送、删除、批量移动等操作提供可审计的人工确认。

## 当前状态

项目处于架构和基础设施阶段，当前提交包含产品代码架构、数据模型、MCP 工具边界、安全策略和开发路线。

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

当前阶段先完成架构和契约设计。后续初始化依赖后，预计使用以下命令：

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
```

## 许可证

许可证将在首个可运行版本前确定。
