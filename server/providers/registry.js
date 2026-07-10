import { openaiProvider } from './openai.js';
import { geminiProvider } from './gemini.js';

const providers = [openaiProvider, geminiProvider];

export function listProviders() {
  return providers
    .filter((p) => p.isConfigured())
    .map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models,
    }));
}

export function getProvider(id) {
  const provider = providers.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Provider not configured: ${id}`);
  }
  return provider;
}
