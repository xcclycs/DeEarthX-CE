# MEMORY.md — 跨会话备忘

## 重要行为约束（2026-05-11）

### ServerGuardian 重启安全规则
- **只要有未处理的待确认修复操作（pendingActions.length > 0），任何情况下都禁止自动重启服务端**
- `approveActions()` 执行完"本次批准"的操作后，若有剩余 pendingActions → 回到 `awaiting_user` 不重启
- 若所有操作已执行完毕（pendingActions.length === 0）→ 设为 `awaiting_user + restartNeeded: true`，**等用户手动调用 `confirmRestart()` 才重启**
- 前端对应：显示"确认重启服务端"按钮，用户点击后发送 `guardian_restart` WS 消息
- 涉及文件：`backend/src/guardian/index.ts`、`backend/src/core.ts`、`front/src/views/GuardianView.vue`
