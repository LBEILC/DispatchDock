# 干活方适配器

技能只依赖 Node 24 内置模块。分发时复制整个 `codex-dispatch/`，保留 `lib/`、`adapters/` 和入口的相对位置。

当前入口只接入 `codex`。公共层处理参数、配置、记录名、清单、进度、窗口和生命周期；适配器只处理检测、启动参数及原始事件映射。不要在公共层再次判断 Codex 的事件类型。

## 接口

| 成员 | 约定 |
|---|---|
| `id` | 清单中的干活方标识，当前为 `codex` |
| `writesReport` | 是否由干活方写 `report`。为 `false` 时公共层把最后一条 `say.text` 原样写入；没有 `say` 时不虚构汇报 |
| `detect({env, settings})` | 返回（或异步返回）`{installed, version}`；取不到版本写 `null`，可携带适配器私有的 `launcher` / `error`。检测只运行版本命令，不发任务 |
| `command({root, report, prompt, settings, detection, env})` | 返回 `{executable, args, stdin}`，分别为可执行文件、字符串数组、输入文本。公共层固定 `shell:false`；检测结果原样传回此处 |
| `mapLine(line, {root})` | 一行 stdout 转成零到多个事件数组。事件只含协议规定的 `kind` 及附加字段，`v/seq/at` 由公共层追加。未知 JSON 事件丢弃，非空非 JSON 行转 `text` |

`root`、`report` 是绝对路径。`settings` 包含 `model/effort/tier/sandbox/path/watchWindow`。模型、强度、档位为 `null` 时不得拼入参数。stdout 会同时存入原始日志，JSON 对象补 `_at`；stderr 保持旧版原文写入方式。命令退出等待 `close`，确保所有输出读取完毕后才写 `end`。

统一事件以 [文件协议](../../../docs/protocol.md) 为准。`say/think` 保留完整换行；命令 `start/end` 用同一个 `id`；命令结果按前 200 行且最多 16384 字节截断；文件路径相对 `root`，使用 `/` 分隔。`progress.log` 只调用公共 `formatProgress`，不能再解析原始事件。

## 最小模板

以下仅演示接口，不是已接入的其他干活方。实际接入前须先确认协议、配置和安装器支持范围。

```js
import { spawnSync } from 'node:child_process';

export function makeAdapter(executable) {
  return {
    id: 'example',
    writesReport: false,
    detect({ env }) {
      const r = spawnSync(executable, ['--version'], {
        env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000,
      });
      return { installed: r.status === 0, version: r.status === 0 ? r.stdout.trim() : null };
    },
    command({ prompt }) {
      return { executable, args: ['--stdin'], stdin: prompt };
    },
    mapLine(line) {
      // 根据目标工具实际输出协议替换此处；文本会成为最终汇报。
      return line.trim() ? [{ kind: 'say', text: line }] : [];
    },
  };
}
```

## Codex 启动与配置

- `agents.codex.path` 有值时直接使用，不查 PATH；Node 入口（`.js` / `.mjs` / `.cjs`）用 `process.execPath`，可执行文件直接启动，`.cmd` / `.bat` 按 npm 包装解析；文件不存在或包装不支持则报错。未设置时在 PATH 中查找 `codex.exe` 或 npm `codex.cmd`。标准 npm 包装解析为 Node 入口，用 `process.execPath` 启动；不经过 shell，因此空格和中文参数不会被拆开。未识别的批处理包装明确报错，不猜测脚本语义。
- 参数：保留任务文字 / 文件、补充说明、`--role`、`--name`；新增 `--host`、`--model`、`--effort`、`--tier`、`--sandbox`、`--watch-window`。优先级为命令行 > 环境变量 > `config.json` > 内置默认。
- `CODEX_DISPATCH_HOME` 优先指定公共目录。模型、强度、档位默认 `null`，沙箱默认 `workspace-write`，窗口默认 `auto`。`CODEX_NO_WATCH` 的非空值沿用旧行为，禁用窗口；显式 `--watch-window` 优先。
- `CODEX_DRY_RUN` 非空时只打印去重后的记录名和任务指令，不检测 agent，不创建目录或文件。
- `CODEX_DISPATCH_TEST_AGENT` 仅供测试，指定一个 Node 脚本代替 Codex 入口。正常派发不要设置。自动测试使用临时目录和假进程；`npm run verify` 不访问真实 agent。
- `auto` 在非交互 Windows 环境且查看器未接管时打开窗口；`always` 忽略查看器接管，仍保留旧版交互终端不重复弹窗的行为；`never` 禁止弹窗。
- 占好记录名后立即打印“记录名：”和“进度：”两行。配置缺失或无效时，“配置：”提示紧跟进度首行，并打印到标准输出。所有错误前缀统一为“出错：”；PowerShell 包装去壳和转义与现有的查看器对齐。
- `--config` 查看默认值与来源，`--config 键=值` 修改，值 `-` 写入 null；`--config init` 只在配置不存在时创建。配置写入保留未知字段，先写临时文件再改名。

手动真实验收：在仓库根目录运行 `node tools/verify-real-codex.mjs`。该命令会使用现有 Codex 登录状态，在临时中文和空格路径下新建 git 仓库，仅派发“只回复 OK，不改任何文件”，并保留临时证据供检查。不会改动真实派发安装、配置或清单。
