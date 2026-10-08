---
allowed-tools:
  - read
  - grep
  - glob
---

<!-- host:dispatch -->
3. **后台派发**：exec 工具，`timeout: 0`，`workdir` 设为仓库根目录，运行上面的命令并加 `--host devin`，例如：
   ```
   node "<技能目录>/codex-task.mjs" docs/specs/012-xxx.md --role engineering --host devin
   ```
   派出后用 `get_output` 看一下开头的输出，拿到实际记录名。
<!-- /host:dispatch -->

<!-- host:wait -->
5. **等待时**不要编辑 Codex 可能在改的文件，避免它 `git add` 时把你的半成品一起提交。可以做不冲突的事。用 `get_output` 等后台 shell 结束；用户问进度时读 `progress.log` 的末尾几十行。
<!-- /host:wait -->

<!-- host:interrupt -->
- **Devin 重启会连带中断 Codex**（它是 Devin shell 的子进程）。在 Devin 内部让它脱离父进程的办法（WMI、计划任务、explorer 启动）都不可靠；需要重启也不中断，就让用户在监控软件里打开托管。中断了就重新派发，在补充说明里写明"上次中断，工作区里未提交的文件是上次写的，核对后继续"。
<!-- /host:interrupt -->
