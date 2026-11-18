# 通用派发与只读 DeepSeek 执行端

上级负责描述任务、读取汇报并验收；执行端负责完成任务，监控软件负责进度和生命周期。上级和执行端不必使用同一种模型。现有默认行为仍然是派给 Codex CLI，原来的命令不用修改。

## 由任意上级派发

在目标仓库中调用：

```text
node <技能目录>/codex-task.mjs "检查主要流程，列出有文件与行号证据的问题" --host codex --agent deepseek --model <DeepSeek模型ID> --sandbox read-only --name review
```

`--host` 为上级标识，`--agent` 为执行端标识，均为小写字母开头的小写字母、数字、连字符，最长 64 字符。可用 `codex`、`claude-code`、`devin` 或自己的名称。省略 `--agent` 始终使用 `codex`。省略 `--host` 保留 Claude Code/Devin 的识别，并在存在 `CODEX_THREAD_ID` 时识别 Codex。

此处不改变技能安装器：连接页仍只给 Claude Code 与 Devin 安装技能。其他上级可以直接调用仓库或既有技能安装中的脚本，不依赖特定的聊天工具。不要把 Claude Code 的后台工具调用语法原样交给其他上级；由上级使用自己的进程工具启动脚本。

## 内置 DeepSeek

需要 Node 24，不增加 npm 依赖。执行端从进程环境读取 `DEEPSEEK_API_KEY`，从 `--model` 或 `DEEPSEEK_MODEL` 读取模型 ID；不内置易过期的模型名。可用 `DEEPSEEK_BASE_URL` 指定兼容地址，默认是官方 API。地址要求 HTTPS，本机回归可使用回环 HTTP；禁止带用户名、密码、查询参数或片段。

这个执行端可列目录和读取 UTF-8 文件，适合代码检查、资料核对与总结。它不提供写文件、终端或再次派发工具。强制 `read-only`，检查仓库边界与符号链接目标，隐藏 `.git`、`.env`、常见凭据及私钥文件。路径检查不是操作系统沙箱，也不能识别所有任意命名的秘密；应在为任务准备的仓库副本中运行，不给它包含凭据的目录。

每个任务最多 12 轮模型请求、32 次工具调用，单轮最多 4096 输出 token，总时限 10 分钟；429 和部分服务端错误最多重试两次。达到限制、输出截断、无完整汇报或 HTTP 错误时非零退出。这里没有金额预算或全天任务队列，限额也不代表固定费用；真实消耗取决于模型和输入长度。完成后上级读取 `.codex-runs/<记录名>.md`，自行验证结论，再决定下一项任务。

API 密钥不写入任务请求、任务清单或配置示例。托管执行者继承监控软件的环境，密钥不会从调用方通过请求文件传递；要托管 API 执行端，启动监控软件的环境必须已经包含该密钥和所需的 API 地址。模型、执行端路径和参数等通过本次任务请求固定下来，避免运行中更改默认值影响已派发任务。

## 接入其他执行端

在公共 `config.json` 的 `agents` 中增加自己的执行端，例如：

```json
{
  "v": 1,
  "agents": {
    "example": {
      "path": "/absolute/path/to/worker.mjs",
      "args": ["literal argument"],
      "model": "provider/model",
      "sandbox": "read-only"
    }
  }
}
```

Windows 使用本机绝对路径。`path` 为可执行文件或 Node 的 `.mjs/.cjs/.js` 入口；不运行 `.cmd/.bat/.ps1` 包装，不拼 shell 命令。`args` 逐项原样传递。需要 OpenCode、Claude 或其他工具时，编写薄包装将其输入输出转换为以下协议；其 API 调用、授权和工具能力由执行端负责。不要把裸交互式 CLI 直接当成这个协议的执行端。

调用时加 `--agent example`。模型等参数从 `agents.example` 读取，不继承 `agents.codex` 或 `CODEX_MODEL`；对应环境变量为 `DISPATCH_EXAMPLE_MODEL` 等，含连字符的标识转成下划线。优先级仍为命令行 > 环境变量 > 配置。现有 `--config` 和设置页继续管理 Codex 默认值；其他执行端配置直接编辑 `agents.<标识>`。

执行端从 stdin 读取一份以换行结束的 JSON，直到 EOF：

```json
{"v":1,"repo":"/absolute/project","prompt":"任务文字","settings":{"model":"provider/model","effort":null,"tier":null,"sandbox":"read-only"}}
```

向 stdout 逐行输出 [统一事件](protocol.md#31-统一事件-eventsjsonl)，例如：

```json
{"kind":"tool","name":"read_file","detail":"README.md"}
{"kind":"say","text":"最终汇报，包含证据和未验证项。"}
{"kind":"turn","usage":{"input":100,"output":20}}
```

`v/seq/at` 由公共层填写。最后一条 `say` 保存为汇报；执行端必须以非零退出码报告失败，只有日志中的 `error` 事件不代替退出码。stderr 保留原始日志，因此执行端不得打印密钥或认证头。未知 JSON 事件被忽略，非 JSON 文本只记原始进度。`sandbox` 是交给桥接执行端的执行策略，公共层不会为任意程序提供 OS 沙箱；执行端必须落实其声明的约束。

## 父子任务

`--parent <上级任务ID>` 将可选的 `parent` 写入开始记录。派发进程给下级环境注入 `DISPATCH_PARENT_ID=<本任务ID>`；下级再次调用派发入口时自动继承父 ID，显式 `--parent` 优先。参数页显示父任务 ID，已有读取方忽略此可选字段。

这建立任务关联，不自动增加递归执行权限、自动重试、调度队列或验收逻辑，也不级联停止已独立托管的子任务。停止操作仍作用于选中任务的进程树。上级必须按其真实工具能力继续等待、读取汇报并验收；关闭上级会话不会自动生成后续决策。

## 托管与兼容

继续使用现有 `codex-task.mjs` 入口、`.codex-runs` 目录和日志首尾格式。旧的 `Codex 开始/结束` 字样为兼容导入与其他读取方而保留，实际身份以 `agent` 为准。托管仍要求脚本由 DispatchDock 安装且文件校验通过；复制出来或改过的脚本会按现有规则回退为直接运行，不绕过安装校验。

新增 `agent/parent/settings.args` 都是托管请求的可选字段，旧请求默认派给 Codex。升级软件与技能后才能托管通用执行端；旧监控软件拒绝新请求时仍按原有回退逻辑处理。连接和设置页暂不提供通用执行端编辑器。

撤销时停止本次任务，撤回相应代码与自己添加的 `agents.<标识>` 配置即可；没有数据迁移，不改变现有 Codex 配置。验证使用假进程和回环假 API，没有发送真实仓库内容到模型服务。

## 来源与选型

- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)：执行程序实现文件工具并把结果传回模型；本执行端只读，不照搬天气示例代码。
- [OpenCode CLI](https://opencode.ai/docs/cli/) 与 [Providers](https://opencode.ai/docs/providers/)：可作为完整编码执行端候选，已有非交互运行和多提供方能力；当前未安装或接入，不声明其已可用。通用桥接协议让后续接入无需把完整编码运行时复制进 DispatchDock。
- 优先复用项目现有的适配器、生命周期和统一事件，不新增框架依赖。DeepSeek 接入状态为隔离回归已验证、真实付费 API 和长期运行效果待验证。
