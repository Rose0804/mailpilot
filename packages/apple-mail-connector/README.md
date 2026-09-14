# Apple Mail 连接器

本包负责将 macOS Mail.app 映射为 MailPilot 的统一连接器接口。

## 约束

- 所有操作必须显式指定账号。
- Apple Mail 账号优先使用 scripting definition 中的稳定 `account.id`；邮箱文件夹使用当前账号范围内的路径标识。
- 读取和写入分离。
- 写操作必须支持幂等键。
- 不直接把 Mail.app 内部数据库格式暴露给上层。
- 自动化权限不足时返回可操作的权限错误。
