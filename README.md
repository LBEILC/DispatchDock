<p align="center"><img src="app/design/icons/app.svg" width="96" alt=""></p>

<h1 align="center">DispatchDock</h1>

<p align="center">让一个 agent 把工作派给另一个 agent，你在一个地方查看、停止、验收。</p>

<p align="center">中文 · <a href="README.en.md">English</a></p>

<p align="center">▶ <a href="https://www.bilibili.com/video/BV1kBHX6CE3d">两分半的介绍视频（B 站）</a></p>

![任务页：左边是任务列表，右边是选中任务的计划和进展时间线](docs/images/tasks-dark.png)

## 这是什么

你在 Claude Code 里和模型讨论、做决定；能写清楚要求的执行工作，让它派给 Codex CLI 在后台去做。DispatchDock 管两件事：

- **派活**：两个技能，装进派活的 agent 里，告诉它怎么派活、怎么看进度、怎么收汇报和验收。
- **看活**：一个桌面软件，所有派出去的任务在一个窗口里看：实时进展、汇报、改了哪些文件，可以随时停止。

两部分可以分开用。只装技能也能工作，进度在一个只读的终端窗口里看。

v0.1 支持：

| | |
|---|---|
| 派活方 | Claude Code（含 Claude 桌面端的 Code 页）、Devin |
| 干活方 | Codex CLI |
| 系统 | Windows 10 / 11 |

## 两个技能

- **`codex-dispatch`**：把一项工作（任务说明文件，或者一段任务文字）派给 Codex，在后台运行，跟进进度，读汇报，审查结果。它本身不带角色。
- **`dual-role-workflow`**：一种分工方式。对话里的模型当"设计负责人"，只做方向、审美、决定和验收；Codex 当"工程负责人"，做所有能写清楚要求、能客观验收的执行工作。目的是把贵的 token 花在判断上，把量大的执行交给 Codex。

## 监控软件

| | |
|---|---|
| ![汇报页，TODO(design) 和推断清单高亮显示](docs/images/report-light.png) | ![连接页，显示各派活方装的技能版本和 Codex 的状态](docs/images/connect-dark.png) |

- **任务**：进行中的任务排在最上面，实时显示最新一步和用时。详情里能看计划、进展时间线（命令可以展开看输出）、汇报、改动的文件、派发参数。任务结束时发系统通知。
- **连接**：检测本机装了哪些派活方，一键安装、更新技能；安装前自动备份，可以回退。你自己改过的技能默认不替换。
- **设置**：派发默认的模型、推理强度、档位、沙箱；不设就跟随 Codex 自己的配置。
- **托管**：打开后，派出去的任务由 DispatchDock 启动。关掉 Claude Code 或 Devin 的会话，甚至关掉 DispatchDock 本身，任务都会照常跑完。

![设置页，托管开关打开](docs/images/settings-dark.png)

## 安装

先准备好：

- [Codex CLI](https://github.com/openai/codex)，已经登录。在终端里运行 `codex --version` 能看到版本号。
- [Node.js](https://nodejs.org/) 24 或更新。派发脚本用 Node 运行，零依赖，不需要 `npm install`。

### 方式一：装软件（推荐）

1. 在 [Releases](https://github.com/LBEILC/DispatchDock/releases) 下载安装包（`.exe`），运行。
2. 安装包没有代码签名。Windows 可能会弹出"Windows 已保护你的电脑"：点"更多信息"，再点"仍要运行"。
3. 第一次打开时有一个引导：检测本机的派活方和 Codex，安装技能，设置默认值。每一步都能跳过，以后在"连接"和"设置"页里改。

### 方式二：只装技能

1. 在 Releases 下载 `dispatchdock-skills-<版本>.zip`，解压。
2. 在解压出来的目录里运行：
   ```bash
   node installer/install.mjs
   ```
   它会检测 Claude Code 和 Devin，把技能装到各自的技能目录，问你要不要设置默认值。已有的技能会先备份。
3. 以后要撤销上一次安装或更新：
   ```bash
   node installer/install.mjs --rollback
   ```

## 怎么用

在 Claude Code 里直接说，例如：

- "把 `docs/specs/012-背包拖拽.md` 交给 Codex 做"
- "用 codex 跑一下：给登录页加上记住我"

模型会用 `codex-dispatch` 在后台派发，告诉你记录名和去哪里看进度。Codex 做完后，它读汇报、看提交、跑验证，再用白话告诉你结果。

想让模型按"设计负责人 + Codex 执行"的方式长期合作，在项目里说"用 dual-role-workflow 建立分工"。它会建好 `AGENTS.md`、角色文档和任务说明目录。

### 默认配置

派发的默认值放在 `config.json`：Windows 在 `%APPDATA%\codex-dispatch\`，其他系统在 `~/.config/codex-dispatch/`。可以在软件的设置页改，也可以用命令：

```bash
node <codex-dispatch 技能目录>/codex-task.mjs --config
```

不加参数是查看，加 `model=<模型>`、`effort=high` 这类参数是修改，值写 `-` 表示改回跟随 Codex。

## 工作原理

技能和软件之间不走网络，只通过本机的几个文件通信：

- 每个任务的记录在仓库的 `.codex-runs/` 下：汇报、精简进度、结构化事件、原始输出。
- 所有任务的清单在 `%APPDATA%\codex-dispatch\runs.jsonl`。

格式写在 [`docs/protocol.md`](docs/protocol.md)。别的工具想读这些任务、或者想接一个新的干活方，照着它写就行；适配器的写法见 [`skills/codex-dispatch/adapters/README.md`](skills/codex-dispatch/adapters/README.md)。

## 隐私

一切都在本机。DispatchDock 自己不联网、不收集任何数据；联网的只有 Codex 本身。

## 开发

```bash
npm install
npm run fonts      # 从官方下载页获取 MiSans 字体（不进仓库）
npm run demo       # 用演示数据启动，不碰你真实的任务
npm run verify     # 测试和类型检查
npm run dist       # 打安装包
```

这个项目本身就是用 `dual-role-workflow` 做的：分工写在 [`AGENTS.md`](AGENTS.md) 和 [`docs/roles/`](docs/roles/)，界面规范在 [`docs/design.md`](docs/design.md)，界面稿在 [`app/design/`](app/design/)。

## 许可证

[MIT](LICENSE)。界面字体 MiSans 和图标库 Remix Icon 的声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
