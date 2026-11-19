# 自选上下级 AI：可复制的调用入口

本文件与 examples、脚本一起分发。源码仓库的[完整流程](https://github.com/LBEILC/DispatchDock/blob/main/docs/ai-workflow.md)提供角色、恢复与边界说明；PR 尚未合并时应查看对应分支。

## 配置一次

需要 Node 24，无 npm 依赖。复制 `examples/agents.example.json`，填写自己实际使用的地址、模型和凭据环境变量名。把密钥放到启动进程的环境中，不写进 JSON、任务或日志。

```text
node <本技能绝对目录>/dispatch.mjs agents import <连接配置.json>
node <本技能绝对目录>/dispatch.mjs agents list
node <本技能绝对目录>/dispatch.mjs agents check builder
```

导入会备份已有配置，同名需显式 --replace。check 只检查本地可启动性/凭据变量存在，不调用网络。默认配置目录仍为 codex-dispatch；CODEX_DISPATCH_HOME 可隔离目录。

## 日常调用

复制 `examples/workflow.example.json` 到目标 Git 仓库。填写 goal、director、worker、reviewer、允许修改的 files、只读 contextFiles、预先固定的 checks 与限额。director 规划一次，worker 写文件，程序独立跑检查，reviewer 读实际文件决定 accept/rework/stop；失败在预算内返工，完成后推进下一项。

在目标仓库根目录运行：

```text
node <本技能绝对目录>/dispatch.mjs workflow <工作流.json>
node <本技能绝对目录>/dispatch.mjs status <工作流name>
node <本技能绝对目录>/dispatch.mjs workflow <同一工作流.json> --resume
node <本技能绝对目录>/dispatch.mjs stop <实际输出的记录名>
```

保持 CLI 进程存活。规划期间还未登记队列，可在启动终端中断；进入队列后按实际记录名停止进程树。恢复复用计划、预算和已完成任务，目标/权限/执行与验收配置改变会拒绝。新的任务使用新的 name。此命令不安装常驻服务，也不自动升级全局技能或桌面软件。

已有任务卡用 `run <计划.json>`，只规划供人检查用 `plan <工作流.json> --out <计划.json>`，当前上级直接派一项用 `task "任务" --agent builder`（默认只读；显式策略方可写入）。--host 仅记来源，实际规划/验收用 director/reviewer 选择。

## 连接与安全边界

- chat-completions 需要兼容接口和工具调用，配置 model 与 api:{baseUrl,apiKeyEnv,parameters?}。codex 使用本机 CLI，也可另取名字。bridge 配置绝对 path、字面 args 和 credentialEnv，以 examples/bridge-template.mjs 为起点实现任意 CLI/SDK；仅有网页聊天不能直接接入。
- 桥接 stdin 包含 v/repo/prompt/operation/outputSchema/settings，stdout 输出统一 JSONL，最后 say.text 是结果；失败非零退出。plan/review 只读，review 结果为 {"decision":"accept|rework|stop","feedback":"证据"}。模板没有真实实现时会失败。
- 内置 API 落实文件工具约束，外部桥接必须自己落实 sandbox/policy。程序事后检查 Git 可观察的越界改动，不能替代 OS 隔离。检查命令执行项目代码，应使用隔离工作树，不提供生产数据。
- 限额是执行端请求/token、任务次数/时长与验收次数；规划和验收有单独调用限制，外部 CLI 内部费用不能统一测量，未知用量保留预留，不是全工作流货币上限。
- 证据在目标仓库 .codex-runs；停止保留修改，不自动回滚/提交/推送/发布。独立托管任务不自动级联停止。当前顺序执行，不是 DAG 调度器。

程序可 import 本目录 index.mjs 的 workflow({request,root})、run({plan,root,resume})、plan({request,root}) 与 invoke({agent,operation,prompt,root,outputSchema})。Windows 使用 file:///D:/... 模块 URL。
