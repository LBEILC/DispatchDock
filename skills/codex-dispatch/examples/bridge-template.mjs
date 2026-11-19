// 只把任意 AI 工具接到统一契约；不能把未接入或空输出当作验收通过。
let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw Error('请求过大'); }
const request = JSON.parse(input);
async function callYourAgent({ operation, prompt, repo, settings, outputSchema }) {
  // 在这里调用自己的 CLI/SDK；参数用数组，凭据从声明的环境变量读取。
  // operation 为 execute/plan/review。plan/review 最终必须返回符合 outputSchema 的 JSON 字符串。
  // execute 的修改范围和检查命令在 settings.policy 中，适配器负责落实约束。
  throw Error('示例尚未接入 AI：请实现 callYourAgent，不能直接用于真实任务');
}
try {
  const result = await callYourAgent(request);
  if (typeof result !== 'string' || !result.trim()) throw Error('AI 没有返回有效结果');
  console.log(JSON.stringify({ kind: 'say', text: result }));
} catch {
  console.log(JSON.stringify({ kind: 'error', text: '桥接执行失败；请检查适配器，未将空结果当作成功' }));
  process.exitCode = 1;
}
