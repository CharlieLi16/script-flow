import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assignSides,
  createNodeId,
  getImagesDir,
  readTimeline,
  saveImageBuffer,
  writeTimeline,
} from './store.js';
import {
  copyImageToRefs,
  getRefsDir,
  loadReferences,
  readLibrary,
  saveRefBuffer,
  writeLibrary,
} from './library.js';
import { getProvider, listProviders } from './providers/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3847;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/images', express.static(getImagesDir()));
app.use('/refs', express.static(getRefsDir()));

function findNode(timeline, id) {
  return timeline.nodes.find((n) => n.id === id);
}

app.get('/api/timeline', async (_req, res, next) => {
  try {
    const timeline = await readTimeline();
    timeline.nodes = assignSides(timeline.nodes);
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

app.put('/api/timeline', async (req, res, next) => {
  try {
    const { title, nodes } = req.body;
    const timeline = await readTimeline();
    if (title !== undefined) timeline.title = title;
    if (nodes !== undefined) timeline.nodes = assignSides(nodes);
    await writeTimeline(timeline);
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

app.post('/api/nodes', async (req, res, next) => {
  try {
    const timeline = await readTimeline();
    const node = {
      id: createNodeId(),
      title: req.body.title || '新节点',
      timeLabel: req.body.timeLabel || '',
      script: req.body.script || '',
      imageUrl: '',
      imagePrompt: '',
      referenceUrls: [],
      durationMs: 4000,
      subtitle: '',
      cameraPreset: 'static',
      side: undefined,
    };
    const index = req.body.index;
    if (typeof index === 'number' && index >= 0 && index <= timeline.nodes.length) {
      timeline.nodes.splice(index, 0, node);
    } else {
      timeline.nodes.push(node);
    }
    timeline.nodes = assignSides(timeline.nodes);
    await writeTimeline(timeline);
    res.status(201).json(node);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/nodes/:id', async (req, res, next) => {
  try {
    const timeline = await readTimeline();
    const node = findNode(timeline, req.params.id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const fields = [
      'title',
      'timeLabel',
      'script',
      'imageUrl',
      'imagePrompt',
      'referenceUrls',
      'durationMs',
      'subtitle',
      'cameraPreset',
      'side',
    ];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'durationMs') {
          const duration = Number(req.body[field]);
          node[field] = Number.isFinite(duration)
            ? Math.min(600000, Math.max(500, duration))
            : 4000;
        } else {
          node[field] = req.body[field];
        }
      }
    }
    timeline.nodes = assignSides(timeline.nodes);
    await writeTimeline(timeline);
    res.json(node);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/nodes/:id', async (req, res, next) => {
  try {
    const timeline = await readTimeline();
    const before = timeline.nodes.length;
    timeline.nodes = timeline.nodes.filter((n) => n.id !== req.params.id);
    if (timeline.nodes.length === before) {
      return res.status(404).json({ error: 'Node not found' });
    }
    timeline.nodes = assignSides(timeline.nodes);
    await writeTimeline(timeline);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/nodes/reorder', async (req, res, next) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of node ids' });
    }
    const timeline = await readTimeline();
    const map = new Map(timeline.nodes.map((n) => [n.id, n]));
    const reordered = order.map((id) => map.get(id)).filter(Boolean);
    if (reordered.length !== timeline.nodes.length) {
      return res.status(400).json({ error: 'Invalid reorder: ids mismatch' });
    }
    timeline.nodes = assignSides(reordered);
    await writeTimeline(timeline);
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

app.get('/api/providers', (_req, res) => {
  res.json(listProviders());
});

app.get('/api/library', async (_req, res, next) => {
  try {
    const library = await readLibrary();
    res.json(library);
  } catch (err) {
    next(err);
  }
});

app.post('/api/library', upload.single('image'), async (req, res, next) => {
  try {
    const library = await readLibrary();
    const name = (req.body.name || '未命名参考').trim() || '未命名参考';

    let id;
    let imageUrl;

    if (req.file) {
      const ext = extFromMime(req.file.mimetype);
      ({ id, imageUrl } = await saveRefBuffer(req.file.buffer, ext));
    } else if (req.body.imageUrl) {
      ({ id, imageUrl } = await copyImageToRefs(req.body.imageUrl));
    } else {
      return res.status(400).json({ error: 'image file or imageUrl required' });
    }

    const item = { id, name, imageUrl, createdAt: new Date().toISOString() };
    library.items.unshift(item);
    await writeLibrary(library);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/library/:id', async (req, res, next) => {
  try {
    const library = await readLibrary();
    const item = library.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.body.name !== undefined) item.name = req.body.name.trim() || item.name;
    await writeLibrary(library);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/library/:id', async (req, res, next) => {
  try {
    const library = await readLibrary();
    const before = library.items.length;
    library.items = library.items.filter((i) => i.id !== req.params.id);
    if (library.items.length === before) {
      return res.status(404).json({ error: 'Item not found' });
    }
    await writeLibrary(library);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/refs/upload', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const ext = extFromMime(req.file.mimetype);
    const { imageUrl } = await saveRefBuffer(req.file.buffer, ext);
    res.json({ imageUrl });
  } catch (err) {
    next(err);
  }
});

function extFromMime(mime) {
  if (mime?.includes('jpeg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  return 'png';
}

app.post('/api/generate', async (req, res, next) => {
  try {
    const { nodeId, provider, model, prompt, size, referenceUrls } = req.body;
    if (!nodeId || !provider || !prompt) {
      return res.status(400).json({ error: 'nodeId, provider, and prompt are required' });
    }

    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const references = await loadReferences(referenceUrls || []);
    const p = getProvider(provider);
    const result = await p.generate({
      model,
      prompt,
      size: size || '1024x1024',
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const imageUrl = await saveImageBuffer(nodeId, result.buffer, ext);

    node.imageUrl = imageUrl;
    node.imagePrompt = prompt;
    await writeTimeline(timeline);

    res.json({ imageUrl, node });
  } catch (err) {
    next(err);
  }
});

app.post('/api/nodes/:id/upload', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const timeline = await readTimeline();
    const node = findNode(timeline, req.params.id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const ext = req.file.mimetype?.includes('jpeg') ? 'jpg' : 'png';
    const imageUrl = await saveImageBuffer(req.params.id, req.file.buffer, ext);
    node.imageUrl = imageUrl;
    await writeTimeline(timeline);

    res.json({ imageUrl, node });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  const configured = listProviders();
  console.log(`Script Flow running at http://localhost:${PORT}`);
  if (configured.length === 0) {
    console.log('No image providers configured. Copy .env.example to .env and add API keys.');
  } else {
    console.log(`Image providers: ${configured.map((p) => p.label).join(', ')}`);
  }
});
