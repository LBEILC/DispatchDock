# DispatchDock

让一个 agent 把工作派给另一个 agent，并让人能统一看到、停止、验收这些工作。打算开源，由两部分配套组成：

- **派发技能**（`skills/`）：`codex-dispatch`（派活、看进度、收汇报，不带角色）和 `dual-role-workflow`（设计负责人做决策和审美，Codex 做执行）。可以单独使用，不装软件也能用，此时用终端只读窗口看进度。
- **监控软件**（`app/`，参照现有查看器的"任务"页，交互重新设计）：统一查看、停止任务，管理派发默认配置，给各派活方安装和更新技能。

两部分只通过本机文件协议通信，见 `docs/protocol.md`。v0.1 只支持：派活方 Claude Code（含 Claude 桌面端的 Code 页）和 Devin，干活方 Codex CLI。

技术栈：派发技能是零依赖的 Node.js 脚本（Node 24，不需要 `npm install`）；监控软件是 Electron + TypeScript，esbuild 构建，渲染层用原生 HTML/CSS + TypeScript，沿用现有查看器的设计令牌和组件库（本仓库的令牌在 `app/design/tokens.css`）。平台先做 Windows 10/11，但不写死只有 Windows 才有的东西（路径、盘符、进程控制要有一层可替换的实现）。

## 角色

| 角色 | 负责什么 | 角色文档 |
|---|---|---|
| 设计负责人 | 需求、范围、协议取舍、技能正文（SKILL.md）、视觉与文案、任务说明、验收 | `docs/roles/design.md` |
| 工程负责人 | 派发脚本与适配器、监控软件的主进程与界面实现、安装器、测试、打包、验收工具 | `docs/roles/engineering.md` |

开工前你会被告知自己的角色，然后去读对应的角色文档。不要因为自己是哪个模型就推断角色；没被告知时先问用户。

## 共同规则

- 和用户交流用中文；代码注释用中文。
- 只 `git add` 具体文件，不用 `git add -A` / `git add .`。提交时在命令末尾列出路径：`git commit -m "…" -- <文件1> <文件2>`，只提交这些文件，不带走别人已暂存的东西；新文件先 `git add` 再这样提交。
- 提交信息用中文写一句话：工程提交加 `[工程]` 前缀，设计提交加 `[设计]` 前缀。
- 只做任务说明范围内的事，不做无关改动。派发技能保持零依赖；监控软件新增依赖要在汇报里说明，并优先选发布超过 7 天的版本。
- **开发和测试不碰用户正在用的东西**：不改 `~/.claude/skills/`、`%APPDATA%\devin\skills\`、`%APPDATA%\codex-dispatch\` 里的真实文件，也不停止真实的 Codex 进程。测试一律用隔离目录（环境变量 `CODEX_DISPATCH_HOME` 指向临时目录）和假的 agent 进程。只有任务说明明确要求、并写明怎么回退时，才动真实安装。
- 现有的查看器仅作只读参照，不修改（参照位置见内部文档 `docs/internal.md`；公开仓库里没有这个文件）。它目前也读 `%APPDATA%\codex-dispatch\runs.jsonl`，所以协议改动必须对它向后兼容（见 `docs/protocol.md`「兼容」）。
- 准备开源：代码、测试样例、文档、截图里不出现本机隐私（用户名路径、真实 IP、账号、会话 ID）。测试样例用假路径和匿名化的事件。
- **现有的查看器是用户自用、不公开的软件**。会公开的东西里（`skills/`、`app/`、`tests/`、代码注释、README、界面文案、截图）不出现该软件的专用名称和本机路径；需要提到时说"现有的查看器"或"其他读取方"。只有 `docs/` 下的内部文档可以提它作参照（公开前另行清理，见 `docs/requirements.md` 第 3 节）。
- 调用外部程序时，参数用数组传，不拼 shell 命令字符串。
- `node_modules/`、构建产物、`.codex-runs/`、日志都不进 git。
- 远程仓库暂未建立；公开发布由用户决定。

## 文件归属

| 文件 | 归属 |
|---|---|
| `docs/`（需求、协议、设计、任务说明、角色） | 设计 |
| `skills/*/SKILL.md`、`skills/_hosts/`（技能正文与各宿主差异） | 设计 |
| `skills/codex-dispatch/` 下的脚本、适配器及其说明 | 工程 |
| `app/design/`（视觉稿、设计令牌）、界面文案文件 | 设计 |
| `app/` 其余部分、`installer/`、`tests/`、`tools/`、`package.json`、构建与打包配置 | 工程 |

## 文档地图

- 需求与范围：`docs/requirements.md`
- 界面：`docs/design.md`，界面稿 `app/design/`
- 文件协议：`docs/protocol.md`
- 任务说明：`docs/specs/NNN-简述.md`，索引在 `docs/specs/README.md`
- 角色：`docs/roles/`
