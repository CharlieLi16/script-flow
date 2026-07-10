import OpenAI from 'openai';
import { toFile } from 'openai';

const MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'dall-e-3', label: 'DALL·E 3' },
];

export const openaiProvider = {
  id: 'openai',
  label: 'OpenAI',
  models: MODELS,
  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  },
  async generate({ model, prompt, size = '1024x1024', references = [] }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const modelId = model || 'gpt-image-2';

    let response;

    if (references.length > 0 && modelId !== 'dall-e-3') {
      const imageFile = await toFile(references[0].buffer, 'reference.png', {
        type: references[0].mime,
      });
      const refNote =
        references.length > 1
          ? ` Use the style and elements from ${references.length} reference images.`
          : ' Match the reference image style and composition.';
      response = await client.images.edit({
        model: modelId,
        image: imageFile,
        prompt: prompt + refNote,
        size,
        n: 1,
      });
    } else {
      if (references.length > 0 && modelId === 'dall-e-3') {
        prompt = `${prompt} (inspired by reference image style)`;
      }
      response = await client.images.generate({
        model: modelId,
        prompt,
        size,
        n: 1,
      });
    }

    const item = response.data?.[0];
    if (!item) {
      throw new Error('OpenAI returned no image');
    }

    if (item.b64_json) {
      return {
        buffer: Buffer.from(item.b64_json, 'base64'),
        mime: 'image/png',
      };
    }

    if (item.url) {
      const res = await fetch(item.url);
      if (!res.ok) {
        throw new Error(`Failed to download OpenAI image: ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mime: res.headers.get('content-type') || 'image/png',
      };
    }

    throw new Error('OpenAI response missing image data');
  },
};
