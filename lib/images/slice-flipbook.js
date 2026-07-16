import sharp from 'sharp';

function axisBounds(length, count) {
  const bounds = [];
  for (let i = 0; i <= count; i += 1) {
    bounds.push(Math.floor((length * i) / count));
  }
  return bounds;
}

export async function sliceFlipbookSheet(buffer, { columns, rows, nodeId, minEdge = 768 }) {
  const cols = Number(columns);
  const rowCount = Number(rows);
  if (!Number.isInteger(cols) || !Number.isInteger(rowCount) || cols < 1 || rowCount < 1) {
    throw new Error('columns and rows must be positive integers');
  }

  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('无法解码分镜表图片');
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  const batchId = Date.now().toString(36);
  const relativeDir = `frames/${nodeId}-${batchId}`;
  const xBounds = axisBounds(width, cols);
  const yBounds = axisBounds(height, rowCount);
  const frames = [];
  const targetMinEdge = Math.max(256, Number(minEdge) || 768);

  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const left = xBounds[col];
      const top = yBounds[row];
      const frameWidth = xBounds[col + 1] - left;
      const frameHeight = yBounds[row + 1] - top;
      const index = row * cols + col;
      const filename = `frame-${String(index).padStart(2, '0')}.png`;
      const logicalPath = `/images/${relativeDir}/${filename}`;

      let pipeline = sharp(buffer).extract({ left, top, width: frameWidth, height: frameHeight });
      const shortEdge = Math.min(frameWidth, frameHeight);
      if (shortEdge > 0 && shortEdge < targetMinEdge) {
        const scale = targetMinEdge / shortEdge;
        pipeline = pipeline.resize(
          Math.round(frameWidth * scale),
          Math.round(frameHeight * scale),
          { kernel: 'lanczos3' },
        );
        pipeline = pipeline.sharpen({ sigma: 0.8, m1: 0.8, m2: 0.4 });
      }

      const frameBuffer = await pipeline.png().toBuffer();
      frames.push({ logicalPath, buffer: frameBuffer, mime: 'image/png' });
    }
  }

  return {
    frames,
    frameUrls: frames.map((f) => f.logicalPath),
    frameCount: frames.length,
    columns: cols,
    rows: rowCount,
    batchId,
  };
}

export function normalizeFps(value, fallback = 4) {
  const fps = Number(value);
  if (!Number.isFinite(fps)) return fallback;
  return Math.min(60, Math.max(1, Math.round(fps)));
}

export function parseGrid(body) {
  const columns = Number(body.columns);
  const rows = Number(body.rows);
  const frameCount = Number(body.frameCount || body.outputFrameCount);
  const dropsLeadingAnchor = Boolean(body.dropsLeadingAnchor || body.dropLeadingFrame);
  if (Number.isInteger(columns) && Number.isInteger(rows)) {
    return { columns, rows, dropsLeadingAnchor };
  }
  const layouts = {
    4: { columns: 2, rows: 2 },
    8: { columns: 3, rows: 3, dropsLeadingAnchor: true },
    9: { columns: 3, rows: 3 },
    16: { columns: 4, rows: 4 },
  };
  const layout = layouts[frameCount];
  if (!layout) throw new Error(`Unsupported frame count: ${frameCount}`);
  return { ...layout, dropsLeadingAnchor: layout.dropsLeadingAnchor || dropsLeadingAnchor };
}
