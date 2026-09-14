# 桌面端

桌面端包含 React 前端和 Tauri Rust 宿主。

## 页面

- 收件箱
- 邮件线程
- 附件检查器
- 审批中心
- 账号设置

## 边界

前端通过本地产品 API 工作，不直接调用 AppleScript、读取 Mail.app 数据库或访问 Keychain。
