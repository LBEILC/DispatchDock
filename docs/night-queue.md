# Codex 指挥 DeepSeek 的夜间队列

队列按预先固定的任务卡顺序执行：DS 修改授权文件 → 队列独立重跑检查 → Codex 读取实际产物并返回结构化验收结果。检查失败或 Codex 返回 `rework` 时，把证据反馈给 DS；只有检查全部通过且 Codex `accept` 才进入下一项。Codex 返回 `stop`、权限越界、预算耗尽或验收进程失败会停止，不把缺证据视为成功。

## 准备

- Node 24、已登录的 Codex CLI、可用的 DeepSeek 兼容接口。
- 通过进程环境提供 `DEEPSEEK_API_KEY`、可选 `DEEPSEEK_BASE_URL`；计划里不存密钥。模型 ID 写在 `worker.model`。
- 在为本轮任务准备的独立 Git 工作树运行，保留原工作区和恢复点。检查命令会执行项目代码，路径检查不是 OS 沙箱；不要让工作树包含真实凭据或生产数据。
- 检查命令必须由上级预先固定，参数数组不经 shell。可执行文件用绝对路径；`@node` 表示运行队列所用的同一个 Node。DS 只能按名称选择这些检查，不能构造任意终端命令。

## 计划文件

```json
{
  "v": 1,
  "name": "night-work",
  "worker": { "model": "your-deepseek-model" },
  "limits": {
    "maxMinutes": 480,
    "maxAttempts": 3,
    "maxRequests": 120,
    "maxTokens": 600000,
    "maxReviews": 20,
    "attemptRequests": 12,
    "attemptTokens": 100000
  },
  "onFailure": "stop",
  "tasks": [{
    "id": "fix-parser",
    "prompt": "修复 parser.mjs 中空输入导致崩溃的问题，保留已有行为。",
    "acceptance": "空输入返回空结果，已有 parser 回归继续通过；不能修改测试来放宽条件。",
    "files": ["src/parser.mjs"],
    "checks": [{
      "name": "parser-tests",
      "executable": "@node",
      "args": ["--test", "tests/parser.test.mjs"],
      "timeoutMs": 60000
    }]
  }]
}
```

`files` 是明确的相对文件路径，不接受 glob、父目录跳转、Windows 设备名/ADS、秘密文件和控制文件。允许新建文件与普通父目录；拒绝目录联接、符号链接目标和硬链接覆盖。默认只读入口仍有效；可写单任务需要 `--sandbox workspace-write --policy <策略.json>`，策略至少含 `v:1`、`files`、`checks`。

检查必须至少一项且名称唯一。不要把验收脚本列进 DS 的可修改文件；自动测试只是证据的一部分，Codex 还会独立检查实际产物。队列在模型修改和检查后核对 Git 可见文件的内容快照；发现清单以外的改动时停止，保留现场，不自动 reset 或删除文件。Git 忽略文件不参与快照，因此检查工具产生的可再生成输出应放在工作树之外，并使用实际隔离环境保护其他数据。

可选的 `supervisor` 接受 `path`（Codex 启动入口绝对路径）、`model`、`effort`、`timeoutMs`；省略时沿用当前 Codex 配置。验收使用 `read-only`、结构化输出 schema 和临时会话，非零退出、格式错误及验收期间的文件修改均不能通过。验收不会获得 DS 的 API key。

## 启动、查看与停止

在目标 Git 工作树中：

```text
node <技能目录>/codex-task.mjs --queue night.json
node <技能目录>/codex-task.mjs --queue-status night-work
node <技能目录>/codex-task.mjs --queue night.json --resume
```

启动会输出队列名、监控记录名和状态路径。队列与每次 DS 尝试都会出现在现有任务清单，DS 尝试以队列记录为父任务。停止时使用本次输出的**记录名**（恢复后可能有数字后缀）：

```text
node <技能目录>/codex-task.mjs --stop <队列记录名>
```

队列子任务关闭独立托管，停止队列会结束它当前的进程树，包括执行端、检查和 Codex 验收。不要只结束等待命令。队列本身是长时间运行的 CLI，启动它的终端或服务必须保持存活；本轮没有安装系统服务，也没有承诺关闭宿主会话后自动存活。使用者需要通过自己已有的可靠服务入口保持该进程运行。

## 断点和费用上限

`.codex-runs/<name>.queue.json` 保存任务状态、尝试次数、用量和固定计划哈希。每个尝试的策略、DS 用量、检查结果与 Codex 判定在 `<name>.queue/<任务ID>/attempt-N/`。密钥不进入这些文件。

- `--resume` 只恢复原计划；任务、验收或限额变更后必须用新队列名。已完成任务不会再调用模型。
- 启动锁核对 PID 与创建时间，防止同时写一个工作树；中断锁只能显式恢复。未完成的文件修改保留并作为下一次尝试的现场。
- 截止时间、尝试次数和消耗从原状态延续，不因重启清零。恢复可能重新执行未完成的一次工作，不承诺网络调用恰好一次。
- 每次启动 DS 前先持久化最坏预算预留。仅在收到完整、可信格式的用量记录时退回未使用额度；进程中断、网络结果未知或用量缺失时保留全部预留，不能通过崩溃绕过限额。
- 请求预算包含 HTTP 重试；DS 在发出请求前预留输入的保守 token 估计并限制输出。token 统计依赖服务端报告，不代表美元或人民币价格承诺。`maxTokens` 只约束 DS；Codex 以 `maxReviews`、单次超时与队列总时限控制，未实现统一货币预算。
- `onFailure` 默认 `stop`；设成 `continue` 时，只在当前任务用完返工次数后尝试下一项。越权、验收异常和总预算耗尽仍停止。

队列完成所有任务后立即结束，不为了耗满一晚而重复工作。先用小任务验证真实接口和权限，再扩大任务量。
