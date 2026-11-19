import { validAgentId } from './options.mjs';

export function containsCredentialFields(object) {
  return object && typeof object === 'object' && Object.entries(object).some(([key, value]) => /(?:key$|token$|auth|password|secret|credential)/i.test(key.replace(/[-_]/g, '')) || containsCredentialFields(value));
}

export function profileOptions(profile = {}) {
  const result = {};
  if (profile.adapter === 'chat-completions' && profile.api === undefined) throw Error('chat-completions 配置必须提供 api.baseUrl 与 apiKeyEnv');
  if (profile.adapter !== undefined) {
    if (!['codex', 'chat-completions', 'bridge'].includes(profile.adapter)) throw Error('adapter 必须为 codex、chat-completions 或 bridge');
    result.adapter = profile.adapter;
  }
  if (profile.api !== undefined) {
    const api = profile.api;
    if (!api || typeof api !== 'object' || typeof api.baseUrl !== 'string' || !/^[A-Z_][A-Z0-9_]*$/i.test(api.apiKeyEnv ?? '')) throw Error('api 需要 baseUrl 与 apiKeyEnv 环境变量名，不能放密钥值');
    const url = new URL(api.baseUrl);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('API 地址必须是无凭据的 HTTPS 地址或回环测试地址');
    if (api.parameters !== undefined && (!api.parameters || typeof api.parameters !== 'object' || Array.isArray(api.parameters))) throw Error('api.parameters 必须为对象');
    if (Object.keys(api).some(key => !['baseUrl', 'apiKeyEnv', 'parameters'].includes(key)) || containsCredentialFields(api.parameters)) throw Error('API 配置不能包含密钥或未知字段');
    result.api = { baseUrl: api.baseUrl, apiKeyEnv: api.apiKeyEnv, ...(api.parameters ? { parameters: api.parameters } : {}) };
  }
  for (const field of ['credentialEnv', 'credentialDenyEnv']) {
    if (profile[field] === undefined) continue;
    if (!Array.isArray(profile[field]) || !profile[field].every(key => typeof key === 'string' && /^[A-Z_][A-Z0-9_]*$/i.test(key))) throw Error(`${field} 必须为环境变量名称数组`);
    result[field] = profile[field];
  }
  return result;
}

export function agentSelection(selection, fallback) {
  if (typeof selection === 'string') selection = { agent: selection };
  selection ??= {};
  const agent = selection.agent ?? fallback;
  if (!validAgentId(agent)) throw Error('请选择有效的 AI 配置名称');
  return { ...selection, agent };
}

// 各角色只接收自己声明的环境凭据；不会把下级的 key 顺手交给上级。
export function agentEnvironment(settings, env = process.env, id = '') {
  const adapter = settings.adapter ?? (id === 'codex' ? 'codex' : id === 'deepseek' ? 'chat-completions' : 'bridge');
  const needed = new Set([...(settings.credentialEnv ?? (adapter === 'codex' ? ['OPENAI_API_KEY', 'CODEX_API_KEY'] : [])), ...(settings.api ? [settings.api.apiKeyEnv] : id === 'deepseek' ? ['DEEPSEEK_API_KEY'] : [])].map(key => key.toLowerCase()));
  const denied = new Set((settings.credentialDenyEnv ?? []).map(key => key.toLowerCase()));
  return Object.fromEntries(Object.entries(env).filter(([key]) => (!denied.has(key.toLowerCase()) && !/(?:api_?key|token|secret|password|authorization|auth_token)/i.test(key)) || needed.has(key.toLowerCase())));
}
