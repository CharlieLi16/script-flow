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
  isConfigured(apiKey) {
    return Boolean(apiKey);
  },
  async generate({ apiKey, model, prompt, size = '1024x1024', references = [] }) {
    const client = new OpenAI({ apiKey });
    const modelId = model || 'gpt-image-2';

    let response;
    if (references.length > 0 && modelId !== 'dall-e-3') {
      const imageFiles = await Promise.all(
        references.map((reference, index) =>
          toFile(reference.buffer, `reference-${index + 1}.png`, { type: reference.mime }),
        ),
      );
      response = await client.images.edit({
        model: modelId,
        image: imageFiles,
        prompt,
        size,
      });
    } else if (modelId === 'dall-e-3') {
      response = await client.images.generate({
        model: 'dall-e-3',
        prompt,
        size,
        n: 1,
      });
    } else {
      response = await client.images.generate({
        model: modelId,
        prompt,
        size,
        n: 1,
      });
    }

    const item = response.data?.[0];
    if (!item) throw new Error('OpenAI returned no image');

    if (item.b64_json) {
      return {
        buffer: Buffer.from(item.b64_json, 'base64'),
        mime: 'image/png',
        ext: 'png',
      };
    }
    if (item.url) {
      const res = await fetch(item.url);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, mime: 'image/png', ext: 'png' };
    }
    throw new Error('OpenAI returned no image data');
  },
};
