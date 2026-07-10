---
name: add-image-provider
description: Add a new pluggable image generation provider to Script Flow. Use when integrating a new image API (fal.ai, SiliconFlow, custom OpenAI-compatible endpoint, etc.) into the script-flow timeline tool.
---

# Add Image Provider to Script Flow

Script Flow uses a small provider plugin system in `server/providers/`. Each provider exposes models to the UI via `GET /api/providers` and handles generation for `POST /api/generate`.

## When to use

- User asks to add a new image gen API to Script Flow
- User wants fal.ai, Flux, SiliconFlow, or another endpoint wired in
- User says "make image generation more pluggable"

## Provider contract

Create `server/providers/<id>.js` exporting:

```js
export const myProvider = {
  id: 'myprovider',           // unique slug
  label: 'My Provider',       // shown in UI optgroup
  models: [
    { id: 'model-id', label: 'Display Name' },
  ],
  isConfigured() {
    return Boolean(process.env.MY_PROVIDER_API_KEY);
  },
  async generate({ model, prompt, size }) {
    // size is like "1024x1024", "1792x1024", "1024x1792"
    // Must return: { buffer: Buffer, mime: 'image/png', ext?: 'png' }
  },
};
```

## Steps

1. **Read existing providers** — `server/providers/openai.js` and `server/providers/gemini.js` are templates.

2. **Implement the provider file** — Keep `generate()` self-contained. Download remote URLs to Buffer if the API returns links.

3. **Register in registry** — Import and append to the `providers` array in `server/providers/registry.js`.

4. **Update `.env.example`** — Add the new env var with a short comment.

5. **Do not change the frontend** — `public/app.js` loads providers dynamically from `/api/providers`. New providers appear automatically when `isConfigured()` returns true.

6. **Test** — Start server, confirm model appears in node editor dropdown, generate an image on a node.

## OpenAI-compatible APIs

If the service exposes `/v1/images/generations`, copy `openai.js` and override:

```js
const client = new OpenAI({
  apiKey: process.env.MY_KEY,
  baseURL: 'https://gateway.example.com/v1',
});
```

## Gemini / Nano Banana

Use native Gemini `generateContent` with `responseModalities: ['TEXT', 'IMAGE']`. See `server/providers/gemini.js`.

## Error handling

Throw `new Error('human-readable message')` from `generate()`. The API returns it as `{ error }` to the UI.

## Checklist

- [ ] `server/providers/<id>.js` created
- [ ] Registered in `registry.js`
- [ ] `.env.example` updated
- [ ] `isConfigured()` gates on env var
- [ ] Returns `{ buffer, mime }` (optional `ext`)
- [ ] Manual test: model visible + image saved to `data/images/`
