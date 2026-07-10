const MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
  { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
];

function mimeToExt(mime) {
  if (mime?.includes('jpeg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  return 'png';
}

function buildParts(references, prompt) {
  const parts = [];

  for (const ref of references) {
    parts.push({
      inline_data: {
        mime_type: ref.mime,
        data: ref.buffer.toString('base64'),
      },
    });
  }

  const refHint =
    references.length > 0
      ? `Using the ${references.length} reference image(s) above for style, characters, and composition. `
      : '';

  parts.push({
    text: `${refHint}Generate an image: ${prompt}`,
  });

  return parts;
}

export const geminiProvider = {
  id: 'gemini',
  label: 'Nano Banana',
  models: MODELS,
  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY);
  },
  async generate({ model, prompt, size = '1024x1024', references = [] }) {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelId = model || 'gemini-3.1-flash-image';

    const [width, height] = size.split('x').map(Number);
    const aspectRatio = width > height ? '16:9' : width < height ? '9:16' : '1:1';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{ parts: buildParts(references, prompt) }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio },
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];

    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType ?? inline.mime_type ?? 'image/png';
        return {
          buffer: Buffer.from(inline.data, 'base64'),
          mime,
          ext: mimeToExt(mime),
        };
      }
    }

    throw new Error('Gemini returned no image in response');
  },
};
