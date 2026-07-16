import { openaiProvider } from './openai.js';
import { geminiProvider } from './gemini.js';

const providers = [openaiProvider, geminiProvider];

export function listProviders(apiKeys = {}) {
  return providers
    .filter((p) => p.isConfigured(apiKeys[p.id === 'openai' ? 'openai' : 'gemini']))
    .map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models,
    }));
}

export function listAvailableProviders(hasTeamKeys, hasPersonalKeys) {
  const result = [];
  for (const p of providers) {
    const envKey = p.id === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
    const personalKey = p.id === 'openai' ? hasPersonalKeys.openai : hasPersonalKeys.gemini;
    if (envKey || personalKey) {
      result.push({ id: p.id, label: p.label, models: p.models });
    }
  }
  return result;
}

export function getProvider(id, apiKey) {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  if (!provider.isConfigured(apiKey)) throw new Error(`Provider not configured: ${id}`);
  return provider;
}

export { providers };
