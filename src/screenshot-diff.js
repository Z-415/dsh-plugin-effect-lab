import crypto from 'node:crypto';
import fs from 'node:fs';
import { evaluateOnce } from './browser-driver.js';

const PNG_SIGNATURE = '89504e470d0a1a0a';
const DEFAULT_GRID = { cols: 64, rows: 40 };
const PIXEL_THRESHOLD = 24;

/** Cheap PNG facts: hash, byte size, and IHDR dimensions. */
export function pngStats(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  const isPng = signature === PNG_SIGNATURE;
  const dimensionsReadable = isPng && buffer.length >= 24;
  return {
    file,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    isPng,
    width: dimensionsReadable ? buffer.readUInt32BE(16) : null,
    height: dimensionsReadable ? buffer.readUInt32BE(20) : null,
  };
}

function diffExpression(beforeBase64, afterBase64, grid) {
  return `(async () => {
    const load = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = 'data:image/png;base64,' + base64;
    });
    const [before, after] = await Promise.all([
      load(${JSON.stringify(beforeBase64)}),
      load(${JSON.stringify(afterBase64)}),
    ]);
    const width = before.naturalWidth;
    const height = before.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(before, 0, 0);
    const left = context.getImageData(0, 0, width, height).data;
    context.clearRect(0, 0, width, height);
    context.drawImage(after, 0, 0);
    const right = context.getImageData(0, 0, width, height).data;
    const cols = ${grid.cols};
    const rows = ${grid.rows};
    const cellChanged = new Array(cols * rows).fill(0);
    const cellTotal = new Array(cols * rows).fill(0);
    let changed = 0;
    for (let y = 0; y < height; y += 1) {
      const row = Math.min(rows - 1, Math.floor((y * rows) / height));
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const delta = Math.abs(left[index] - right[index])
          + Math.abs(left[index + 1] - right[index + 1])
          + Math.abs(left[index + 2] - right[index + 2]);
        const cell = row * cols + Math.min(cols - 1, Math.floor((x * cols) / width));
        cellTotal[cell] += 1;
        if (delta > ${PIXEL_THRESHOLD}) {
          changed += 1;
          cellChanged[cell] += 1;
        }
      }
    }
    const total = width * height;
    const cells = cellChanged.map((value, index) => (cellTotal[index] ? value / cellTotal[index] : 0));
    return JSON.stringify({
      width,
      height,
      changedPixels: changed,
      changedRatio: total ? changed / total : 0,
      cols,
      rows,
      cells,
    });
  })()`;
}

/**
 * Compare two PNG screenshots. Identical bytes short-circuit; otherwise the
 * pixel diff runs inside headless Edge (a real image decoder), returning an
 * overall changed ratio plus a coarse grid for evidence.
 */
export async function compareScreenshots(options = {}) {
  const { before, after, browserPath, grid = DEFAULT_GRID, timeoutMs = 90_000 } = options;
  const left = pngStats(before);
  const right = pngStats(after);
  const result = {
    before: left,
    after: right,
    identical: left.sha256 === right.sha256,
    dimensionsMatch: left.width === right.width && left.height === right.height,
    grid,
  };
  if (result.identical) {
    result.pixels = { changedPixels: 0, changedRatio: 0, width: left.width, height: left.height, cells: [] };
    return result;
  }
  if (!left.isPng || !right.isPng || !result.dimensionsMatch) return result;
  const beforeBase64 = fs.readFileSync(before).toString('base64');
  const afterBase64 = fs.readFileSync(after).toString('base64');
  const raw = await evaluateOnce({
    browserPath,
    timeoutMs,
    expression: diffExpression(beforeBase64, afterBase64, grid),
  });
  result.pixels = JSON.parse(raw);
  return result;
}
