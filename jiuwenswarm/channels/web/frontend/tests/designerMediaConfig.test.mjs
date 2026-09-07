import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTextLikeNodeType,
  readMediaConfig,
  supportsNodeToolbar,
  writeMediaGeneratePatch,
} from '../node_modules/.cache/designer-media-config/mediaNodeConfig.mjs';

test('toolbar generate prompt is also written to config.prompt', () => {
  const next = writeMediaGeneratePatch(
    { role: 'brief', prompt: '旧提示' },
    { prompt: '雨夜巷口' },
  );
  assert.equal(next.prompt, '雨夜巷口');
  assert.equal(next.generate.prompt, '雨夜巷口');
});

test('readMediaConfig falls back to top-level prompt', () => {
  const media = readMediaConfig({ role: 'scene', prompt: '霓虹雨巷' }, 'image');
  assert.equal(media.generate.prompt, '霓虹雨巷');
});

test('table nodes share the text toolbar', () => {
  assert.equal(isTextLikeNodeType('table'), true);
  assert.equal(supportsNodeToolbar('table'), true);
  assert.equal(supportsNodeToolbar('video'), true);
});
