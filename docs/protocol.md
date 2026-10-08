# 文件协议（v0.1）

派发脚本（写）和监控软件（读）之间只通过本文的文件通信。

状态：全部定稿。第 0～6 节 2026-10-08（001 验收后），第 8 节 2026-10-08（002 验收后），第 7 节 2026-10-08（005 实测后，005a 按最终规则实现）。定稿之后的改动按第 0 节的版本规则处理。

## 0. 基本规则

- 全部是 UTF-8、无 BOM。JSONL 文件每行一个完整 JSON 对象，以 `\n` 结尾；读取方只处理以换行结尾的完整行，尾部半行等下次再读。
- **读取方忽略不认识的字段和事件类型**，不报错。
- 版本号 `v` 只在**不兼容**的改动时加 1。同一个 `v` 内只能**新增可选字段**，不能删字段、改名或改含义。
- 写入失败不影响任务本身（派发脚本吞掉清单写入错误）。
- 文件里出现的**相对路径一律用 `/` 分隔**（Windows 也一样，读取方按本平台解析）；绝对路径用本平台的原生写法。

## 1. 公共目录 `<home>`

- `CODEX_DISPATCH_HOME` 环境变量有值时用它（测试和隔离用）。
- 否则 Windows 用 `%APPDATA%\codex-dispatch\`，其他平台用 `$XDG_CONFIG_HOME/codex-dispatch/`，没有 `XDG_CONFIG_HOME` 就用 `~/.config/codex-dispatch/`。

目录名保留 `codex-dispatch`，和现有安装及其他读取方兼容；以后改名属于不兼容改动。

| 文件 | 谁写 | 内容 |
|---|---|---|
| `runs.jsonl` | 派发脚本追加 | 任务清单（第 2 节） |
| `config.json` | 监控软件、安装命令、派发脚本的配置子命令或用户手写 | 派发默认配置（第 4 节） |
| `viewer.json` | 监控软件 | 接管终端窗口（第 5 节） |
| `backups/` | 安装器 | 替换或卸载技能前的备份（第 8 节） |

## 2. 任务清单 `runs.jsonl`（`v: 1`）

每个任务追加若干行，用 `id` 关联。下表中**加粗**的是本次新增的可选字段，其余是更早的读取方已经在读的字段，保持不变。

| `event` | 字段 |
|---|---|
| `start` | `id`、`repo`（仓库根目录，绝对路径）、`name`（记录名，不是路径，规则见第 3 节）、`spec`（任务说明相对仓库根的路径或 null）、`title`、`role`（或 null）、`pid`（派发脚本进程）、`started`（毫秒）、`progress` / `report` / `raw`（绝对路径）、`model`、`effort`、`tier`；**`agent`**（干活方，`"codex"`）、**`agentVersion`**（如 `"codex-cli 0.156.1"`，取不到为 null）、**`sandbox`**、**`events`**（`events.jsonl` 的绝对路径）、**`dispatcher`**（见下） |
| `spawned` | `id`、`codexPid`、`at`；**`agentPid`**（和 `codexPid` 相同，新读取方用它） |
| `end` | `id`、`exit`、`at`、`minutes` |
| `interrupted` | `id`、`signal`、`at` |

- `model` / `effort` / `tier` 在没有覆盖、交给干活方自己配置时写 `null`。旧的读取方显示时可能出现空白，这是可以接受的退化。
- `dispatcher`：`{ "host": "claude-code" | "devin" | "unknown", "session": <宿主会话 ID 或 null> }`。识别顺序：命令行 `--host` > 环境变量 `CLAUDECODE=1`（Claude Code，会话取 `CLAUDE_CODE_SESSION_ID`）> 脚本路径含 `devin`（Devin 的技能目录）> `unknown`。Devin 没有可用的会话 ID 环境变量，`session` 写 null。会话 ID 只写进本机清单，不进任何仓库文件。

## 3. 每个任务的文件

都在 `<仓库>/.codex-runs/` 下，`<name>` 是记录名。

| 文件 | 内容 |
|---|---|
| `<name>.md` | 最终汇报 |
| `<name>.log` | 干活方的原始输出，原样保存，排查用。读取方**不应**依赖它的格式 |
| `<name>.progress.log` | 给人看的精简进度（终端窗口显示它）。首行、末行和各行前缀的格式保持现状，见 3.2 |
| `<name>.events.jsonl` | **新增**：统一事件，见 3.1。监控软件只读它 |

**记录名**：任务说明默认用文件名（不含扩展名），任务文字默认 `task-<时间>`，也可以用 `--name` 指定。规则在所有平台相同：

- 非空；不含 `< > : " / \ | ? *` 和控制字符；不以点或空格结尾；不是 Windows 保留名（`con`、`prn`、`aux`、`nul`、`com1`～`com9`、`lpt1`～`lpt9`，不区分大小写，带扩展名也算）。
- 不合规就报错退出，不自动改名。

**记录名去重**：派发时如果 `<name>.progress.log` 已经存在，自动改用 `<name>-2`、`<name>-3`……，旧任务的文件不再被覆盖。显式给了 `--name` 的也一样。用独占创建占名，同时派发也不会抢到同一个名字。派发脚本开始运行时在标准输出打印实际的记录名和进度文件路径，派活方据此找到进度。

### 3.1 统一事件 `events.jsonl`（`v: 1`）

每行一个事件，公共字段：`v`、`seq`（从 1 递增）、`at`（毫秒）、`kind`。按 `kind` 附加：

| `kind` | 含义 | 附加字段 |
|---|---|---|
| `say` | 干活方说的话 | `text`（完整，保留换行） |
| `think` | 推理摘要 | `text` |
| `cmd` | 执行命令 | `id`、`phase`（`"start"` / `"end"`）、`command`（去掉 shell 外壳后的命令）；`end` 时加 `exit`、`output`（最多 200 行 / 16KB）、`truncated` |
| `file` | 改动文件 | `files: [{ kind: "add" \| "update" \| "delete", path }]`，`path` 相对仓库根（`/` 分隔） |
| `plan` | 计划清单（整份替换） | `items: [{ text, done }]` |
| `tool` | 搜索、MCP 等工具调用 | `name`、`detail` |
| `turn` | 一轮结束 | `usage: { input, output }`（token 数，取不到为 null） |
| `error` | 出错（包括启动干活方失败） | `text`。不区分来源 |
| `text` | 原始输出里无法解析的非空行 | `text` |

- 同一条命令的 `start` 和 `end` 用同一个 `id` 关联。
- 适配器认不出的原始事件类型直接丢弃（原始内容仍在 `.log` 里）。

### 3.2 精简进度 `progress.log`

格式保持现状（`codex-watch.cmd` 和其他读取方依赖它）：

- 首行 `=== Codex 开始：<标题>[（角色：<角色名>）]  <本地时间> ===`
- 中间每行 `[HH:MM:SS] <前缀><内容>`，前缀：`说：`、`思考：`、`运行：`、`  命令失败（exit N）：`、`新增文件：` / `修改文件：` / `删除文件：`、`计划：`、`搜索：`、`工具：`、`一轮结束（…）`、`出错：`、`配置：`；`text` 事件没有前缀
- 旧版里 `item.error` 用的"错误："统一成"出错："；启动失败也写成"出错：…"。读取方仍应把旧日志里的"错误："当作出错
- `配置：` 行只在配置有问题时出现，紧跟在首行之后，最多一行（见第 4 节）
- 末行 `=== Codex 结束：exit=<码>，用时 <分钟> 分钟，汇报在 <路径> ===`

**进度文本由统一事件格式化得到**，不再单独解析原始输出。这样原始格式到统一事件的映射只在适配器里写一次。

和 001 之前的旧版相比，只有三处不同：可能多一行 `配置：`、"错误："改成"出错："、文件路径用 `/` 分隔。其余逐行一致。

## 4. 配置 `config.json`（`v: 1`）

```json
{
  "v": 1,
  "agents": {
    "codex": { "model": null, "effort": null, "tier": null, "sandbox": "workspace-write" }
  },
  "watchWindow": "auto",
  "managed": false
}
```

- `model` / `effort` / `tier` 为 `null` 或缺失：不覆盖，交给干活方自己的配置（Codex 就是不传对应参数）。
- `sandbox` 为 `null` 或缺失：用内置默认 `workspace-write`，**不**交给干活方。Codex 自己默认只读，派出去的工作会写不了文件、提交不了。
- `path`（可选，002 起）：干活方可执行文件或 Node 入口的绝对路径。不填就在 `PATH` 里找。给非标准安装（pnpm、scoop 等包装）用。
- `watchWindow`：`"auto"`（默认：监控软件接管时不弹，否则弹）、`"always"`（忽略接管，总是弹）、`"never"`。不论哪种，派发脚本自己在交互终端里运行时都不弹，因为进度已经直接打印在终端里。
- 取值优先级，逐个字段比较：命令行参数（`--model`、`--effort`、`--tier`、`--sandbox`、`--watch-window`）> 环境变量（`CODEX_MODEL`、`CODEX_EFFORT`、`CODEX_TIER`、`CODEX_SANDBOX`；`CODEX_NO_WATCH` 非空等于 `never`）> `config.json` > 内置默认。环境变量为空字符串等于没设。
- `managed`：托管开关，默认 `false`，见第 7 节。
- 文件不存在或无效（不是 JSON、`v` 不是 1）时按内置默认处理，在进度里写一行提示，不中断任务。提示文案固定，派活方的技能正文靠 `配置：` 开头识别：
  - 文件不存在：`配置：未找到 config.json，模型、强度、档位跟随 Codex 自己的配置`。这表示"还没做过首次配置"（`docs/requirements.md` 2.2）
  - 文件无效：`配置：config.json 无法读取（<原因>），本次按内置默认运行`
- 字段值类型不对（例如 `model` 是数字、`watchWindow` 不在三个取值里）属于派发错误，报错退出，不静默忽略。

## 5. 接管 `viewer.json`

保持现状：`{ "app": <软件名>, "pid": <主进程号>, "suppressWatchWindow": true|false, "updated": <毫秒> }`。`suppressWatchWindow` 为真且 `pid` 仍然存活时，派发脚本不弹终端窗口。

新增可选字段 `acceptsManaged: true`：软件正在运行、能接手托管任务（第 7 节）。是否真的托管还要看 `config.json` 的 `managed`。旧软件没有这个字段，派发脚本按"不能接手"处理。

## 6. 兼容

- 已经在读 `runs.jsonl` 的其他读取方必须能继续读新清单：`v` 仍为 1，原有字段一个不少。
- 不认识 `events.jsonl` 的旧读取方仍然读 `raw`（干活方原始输出）。所以 Codex 适配器下 `.log` 的内容保持现状：每行补 `_at` 毫秒时间戳。

## 7. 托管

目的和取舍见 `docs/requirements.md` 2.5。只有同时满足以下三条才走本节，否则照常由派发脚本自己运行：
- `config.json` 的 `managed` 为真；
- `viewer.json` 的 `pid` 存活；
- `viewer.json` 的 `acceptsManaged` 为真。

目录 `<home>/managed/`。三方：
- **等待者**：派活方启动的派发脚本。
- **软件**：监控软件。
- **执行者**：软件启动的派发脚本，真正运行干活方。

1. **等待者先做完派发前的准备**：解析参数、读配置、按第 3 节占好记录名（独占创建 `progress.log`）、生成任务 `id`。然后写 `<id>.request.json`，先写临时文件再改名：
   ```json
   { "v": 1, "id": "…", "at": 0, "script": "<codex-task.mjs 绝对路径>", "node": "<等待者的 node 可执行文件绝对路径>",
     "repo": "<仓库根>", "name": "<已占好的记录名>", "args": { "task": "…", "extra": "…", "role": null, "spec": null },
     "settings": { "model": null, "effort": null, "tier": null, "sandbox": "workspace-write", "path": null },
     "dispatcher": { "host": "claude-code", "session": null },
     "env": { "PATH": "…", "CODEX_HOME": "…" } }
   ```
   - `settings` 是等待者已经按优先级算好的结果，执行者直接用，不再读环境变量和 `config.json`。
   - `env` 只放找到和运行干活方需要的、**不含机密**的变量：`PATH`、`CODEX_HOME`、`HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`TEMP`、`TMP`、`TMPDIR`、`SystemRoot`、`ComSpec`、`PATHEXT`、代理变量（`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`）、`OPENAI_BASE_URL`。**密钥、令牌一律不写进请求文件**（例如 `OPENAI_API_KEY`）。执行者的环境 = 软件自己的环境，再用请求里的 `env` 覆盖。
2. **软件认领**：发现请求后先核对，通过后用**改名**认领：`<id>.request.json` → `<id>.claimed.json`，改名成功才算认领。随后启动执行者：`<node> <script> --run-request <claimed 文件>`。
   - 执行者**脱离软件的进程树**（detached），软件退出也不影响它。执行者不弹进度窗口（软件开着）。
   - 执行者启动后**第一件事**是把 `<id>.claimed.json` 改名为 `<id>.running.json`，改名成功才继续；失败就直接退出，不写任何记录（说明等待者已经收回）。
   - 软件启动执行者失败时，把 `<id>.claimed.json` 改名为 `<id>.rejected.json` 并写入原因。
   - 执行者沿用请求里的 `id`、记录名和已占好的文件，**不再查重**，写 `runs.jsonl` 的 `start` 时 `pid` 是执行者自己，多一个可选字段 `managed: true`。
3. **核对规则**：
   - `script` 必须在一个由安装器装好、且没被改过的 `codex-dispatch` 目录里：目录里有 `.dispatchdock.json`，文件哈希全部一致。
   - `node` 必须是存在的绝对路径，文件名是 `node` 或 `node.exe`。
   - 不通过就改名为 `<id>.rejected.json`，并在里面加 `reason` 字段（简短中文）。写法：先写好带原因的临时文件，再改名替换，读取方不会看到半个文件。
4. **等待者等认领**：最多等 5 秒。
   - 看到 `rejected`：立刻改为自己运行。
   - 超时：自己把 `<id>.request.json` 改名为 `<id>.withdrawn.json`，改名成功就自己运行；改名失败说明已被认领，按托管继续。
   - 自己运行时，在进度里写一行：`托管：DispatchDock 没有接手（<原因或"超时">），改为直接运行`。
5. **认领成功后**：
   - 等待者在标准输出打印：`托管：任务已交给 DispatchDock，关掉当前会话也不会中断。要停止，在 DispatchDock 里停。` 进度文件里的同一行由**执行者**写（等待者可能提前被结束）。
   - **兜底**：等待者 15 秒内还没在 `runs.jsonl` 看到这个 `id` 的 `start`，就尝试把 `<id>.claimed.json` 改名为 `<id>.withdrawn.json`。改名成功说明执行者没起来（例如软件在认领后崩溃），等待者自己运行，并写"没有接手"那一行，原因写 `软件没有启动任务`；改名失败说明执行者已经接手，继续等。等待期间看到 `<id>.rejected.json` 也立刻自己运行。
   - 之后等待者轮询 `runs.jsonl`，读到同一 `id` 的 `end` 后用它的 `exit` 退出，读到 `interrupted` 用 1 退出；打印和非托管时一样的结束行。
   - 等待者被结束，不影响任务。
6. **停止**：托管任务只在软件里停止（结束执行者的进程树），不提供派发脚本的停止子命令。
7. **清理**：任务结束后，软件删除对应的请求文件；启动时清掉一天以前的残留文件。
## 8. 安装记录与备份

- 安装器在每个装好的技能目录里写 `.dispatchdock.json`：`{ "v": 1, "version": <版本>, "host": <宿主>, "skill": <技能名>, "installedAt": <毫秒>, "files": { <相对路径（/ 分隔）>: <SHA-256 十六进制> } }`。`files` 不包括它自己。监控软件靠它显示已装版本、判断是否被改过。
- 没有这个文件的技能目录，读取方一律当作"不是本安装器装的"。
- 回退可以按宿主、技能限定：取最近一批里属于它的项；最近一批里没有它时，往前找最近一批有它的。
- 备份放在 `<home>/backups/<时间戳>/<宿主>/<技能>/`，每批一个 `<home>/backups/<时间戳>/backup.json`：`{ "v": 1, "at": <毫秒>, "reason": "install" | "rollback" | "uninstall", "items": [{ "host", "skill", "from": <原目录绝对路径>, "version": <版本或 null>, "existed": <true|false> }] }`。只保留最近 5 批。
- **每次安装、回退、卸载都记一批**，记的是"操作之前的样子"，包括操作前目录不存在的情况：`existed: false`，这一项没有备份目录。所以回退就是"撤销上一次操作"：
  - `existed: true`：用备份目录替换当前目录。
  - `existed: false`：删除当前目录（删除前同样先备份）。
  - 回退本身也记一批，所以可以再回退。首次安装后回退等于卸载，卸载后回退等于恢复。
- `existed` 缺失按 `true` 处理（兼容 002 生成的备份）。`existed: true` 但备份目录缺失时，视为备份损坏，拒绝回退。
