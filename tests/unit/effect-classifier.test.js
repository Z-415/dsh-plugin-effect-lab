import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedStringKeys,
  classifyMatrixRuns,
  layerIndex,
} from '../../src/effect-classifier.js';

function dom(tokens = {}, bodyAttributes = {}, layers = []) {
  return { tokens, bodyAttributes, layers };
}

test('changedStringKeys compares stringified values', () => {
  assert.deepStrictEqual(
    changedStringKeys({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }),
    ['b', 'c'],
  );
});

test('layerIndex flattens the layer probe', () => {
  assert.deepStrictEqual(
    layerIndex({ layers: [{ key: 'body::before', zIndex: -1 }, { key: '#overlay', zIndex: 900 }] }),
    { 'body::before': -1, '#overlay': 900 },
  );
});

test('two runs setting the same token to different values are high-conflict', () => {
  const result = classifyMatrixRuns([
    { id: 'base', baseline: true, ok: true, dom: dom({ '--dsw-alias-bg-base': '#fff' }) },
    { id: 'wallpaper', ok: true, dom: dom({ '--dsw-alias-bg-base': 'transparent' }) },
    { id: 'dream-skin', ok: true, dom: dom({ '--dsw-alias-bg-base': '#0d1524' }) },
  ]);
  const byId = Object.fromEntries(result.results.map((item) => [item.id, item]));
  assert.equal(byId.wallpaper.classification, 'high-conflict');
  assert.equal(byId['dream-skin'].classification, 'high-conflict');
  assert.equal(result.hardConflicts.length, 1);
  assert.equal(result.hardConflicts[0].axis, 'tokens');
  assert.deepStrictEqual(result.summary['high-conflict'].sort(), ['dream-skin', 'wallpaper']);
});

test('a run that changes nothing is coexist and a lone theme change is manual-review', () => {
  const result = classifyMatrixRuns([
    { id: 'base', baseline: true, ok: true, dom: dom({ '--dsw-alias-bg-base': '#fff' }) },
    { id: 'ui-tweaks', ok: true, dom: dom({ '--dsw-alias-bg-base': '#fff' }) },
    { id: 'bloom', ok: true, dom: dom({ '--dsw-alias-bg-base': '#fff', '--dsw-alias-label-primary': '#111' }) },
  ]);
  const byId = Object.fromEntries(result.results.map((item) => [item.id, item]));
  assert.equal(byId['ui-tweaks'].classification, 'coexist');
  assert.equal(byId.bloom.classification, 'manual-review');
  assert.deepStrictEqual(result.summary.coexist, ['ui-tweaks']);
  assert.deepStrictEqual(result.summary['manual-review'], ['bloom']);
});

test('a failed run is high-conflict and layer z-index collisions are detected', () => {
  const result = classifyMatrixRuns([
    { id: 'base', baseline: true, ok: true, dom: dom({}, {}, [{ key: 'body::before', zIndex: -1 }]) },
    { id: 'broken', booted: false, dom: dom({}, {}, [{ key: 'body::before', zIndex: -1 }]) },
    {
      id: 'overlay-a',
      booted: true,
      dom: dom({}, {}, [{ key: 'body::before', zIndex: -1 }, { key: '#lab-overlay', zIndex: 10 }]),
    },
    {
      id: 'overlay-b',
      booted: true,
      dom: dom({}, {}, [{ key: 'body::before', zIndex: -1 }, { key: '#lab-overlay', zIndex: 40 }]),
    },
  ]);
  const byId = Object.fromEntries(result.results.map((item) => [item.id, item]));
  assert.equal(byId.broken.classification, 'high-conflict');
  assert.equal(byId['overlay-a'].classification, 'high-conflict');
  assert.equal(byId['overlay-b'].classification, 'high-conflict');
  assert.equal(result.hardConflicts.some((conflict) => conflict.axis === 'layers' && conflict.key === '#lab-overlay'), true);
});

test('a console note does not turn a run into a conflict', () => {
  const result = classifyMatrixRuns([
    { id: 'base', baseline: true, booted: true, dom: dom({ '--dsw-alias-bg-base': '#fff' }) },
    {
      id: 'bloom',
      booted: true,
      dom: dom({ '--dsw-alias-bg-base': '#fff' }),
      notes: ['console: Failed to load resource: 404'],
    },
  ]);
  assert.equal(result.results[0].classification, 'coexist');
  assert.deepStrictEqual(result.results[0].notes, ['console: Failed to load resource: 404']);
});
