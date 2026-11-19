import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveSettings } from './config.mjs';
import { agentSelection, agentEnvironment } from './profiles.mjs';
import { selectAdapter } from '../adapters/bridge.mjs';
import { runProgram } from './program.mjs';

export function resolveActor(config, selection, fallback, env = process.env) {
  const actor = agentSelection(selection, fallback);
  const { settings } = resolveSettings(config, actor, env);
  if (actor.path !== undefined) {
    if (typeof actor.path !== 'string' || !path.isAbsolute(actor.path)) throw Error('AI 启动路径必须为绝对路径');
    settings.path = actor.path;
  }
  return { actor, settings };
}

// 同一调用契约用于规划、执行和验收；模型品牌留在适配器和配置中。
export async function invokeAgent({ config = {}, selection, fallback, operation = 'execute', prompt, root, folder, outputSchema, policy, env = process.env, timeoutMs = 300000 }) {
  if (!['execute', 'plan', 'review'].includes(operation)) throw Error('operation 必须为 execute、plan 或 review');
  const { actor, settings } = resolveActor(config, selection, fallback, env);
  settings.operation = operation; settings.outputSchema = outputSchema;
  if (policy) settings.policy = policy;
  if (operation !== 'execute') settings.sandbox = 'read-only';
  const adapter = selectAdapter(actor.agent, settings), childEnv = agentEnvironment(settings, env, actor.agent);
  const detection = await adapter.detect({ env: childEnv, settings });
  if (!detection.installed) throw Error(detection.error || `无法启动 AI 配置 ${actor.agent}`);
  await mkdir(folder, { recursive: true });
  const call = randomUUID();
  const report = path.join(folder, `response-${call}.md`), schema = path.join(folder, `response-${call}.schema.json`);
  const command = adapter.command({ root, report, prompt, settings, detection, env: childEnv });
  if (outputSchema && adapter.writesReport) {
    await writeFile(schema, JSON.stringify(outputSchema));
    command.args.splice(command.args.length - 1, 0, '--output-schema', schema, '--ephemeral');
  }
  let lastSay = null;
  const result = await runProgram(command.executable, command.args, { root, env: childEnv, stdin: command.stdin, timeoutMs, onLine: line => {
    for (const event of adapter.mapLine(line, { root })) if (event.kind === 'say') lastSay = event.text;
  } });
  if (!adapter.writesReport && lastSay !== null) await writeFile(report, lastSay);
  const privateNames = new Set([...(settings.credentialDenyEnv ?? []), ...(settings.credentialEnv ?? []), settings.api?.apiKeyEnv].filter(Boolean).map(key => key.toLowerCase()));
  const secrets = Object.entries(env).filter(([key, value]) => value && (privateNames.has(key.toLowerCase()) || /api_?key|token|secret|password|authorization/i.test(key))).map(([, value]) => value);
  const redact = text => secrets.reduce((value, secret) => value.split(secret).join('[redacted]'), text).replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]');
  const errors = result.stdout.split('\n').flatMap(line => adapter.mapLine(line, { root })).filter(event => event.kind === 'error').map(event => redact(event.text));
  await writeFile(path.join(folder, 'invocation.json'), JSON.stringify({ agent: actor.agent, adapter: settings.adapter ?? (actor.agent === 'codex' ? 'codex' : actor.agent === 'deepseek' ? 'chat-completions' : 'bridge'), model: settings.model, operation, code: result.code, timedOut: result.timedOut, stderr: redact(result.stderr.slice(-4000)), errors }, null, 2));
  if (result.code) throw Error(`AI ${actor.agent} 的 ${operation} 调用失败（exit=${result.code}），保留现场，未当作成功`);
  const text = await readFile(report, 'utf8');
  if (!text.trim()) throw Error(`AI ${actor.agent} 没有返回结果`);
  if (!outputSchema) return { text, agent: actor.agent };
  let value; try { value = JSON.parse(text); } catch { throw Error(`AI ${actor.agent} 未返回有效 JSON`); }
  return { text, value, agent: actor.agent };
}
