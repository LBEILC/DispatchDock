@echo off
rem 只读查看 Codex 最新任务的精简进度：codex-watch.cmd [仓库目录]，不给参数就用当前目录。关掉窗口不影响任务。
set ROOT=%~1
if "%ROOT%"=="" set ROOT=%CD%
cd /d "%ROOT%"
powershell -NoProfile -NoExit -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $f = Get-ChildItem .codex-runs\*.progress.log -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1; if (-not $f) { '还没有任务进度'; return }; $host.UI.RawUI.WindowTitle = 'Codex 进度（只看）：' + $f.BaseName; Get-Content -LiteralPath $f.FullName -Encoding UTF8 -Wait -Tail 200"
