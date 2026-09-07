import assert from 'node:assert/strict';
import test from 'node:test';

import { extractDesignerSourcePrompt } from '../node_modules/.cache/designer-chat-sync/designerChatSync.mjs';

test('extractDesignerSourcePrompt prefers brief.config.prompt', () => {
  const prompt = extractDesignerSourcePrompt({
    graph_id: 'g1',
    project_id: 'p1',
    title: '截断标题',
    description: '图描述',
    nodes: [
      {
        id: 'n_brief',
        type: 'text',
        label: '项目 brief',
        config: { role: 'brief', prompt: '  做一个赛博朋克短片  ' },
      },
    ],
    edges: [],
  });
  assert.equal(prompt, '做一个赛博朋克短片');
});

test('extractDesignerSourcePrompt falls back to graph.description', () => {
  const prompt = extractDesignerSourcePrompt({
    graph_id: 'g2',
    project_id: 'p1',
    title: 'Untitled',
    description: '只用描述当指令',
    nodes: [{ id: 'n_clip', type: 'video', label: '视频片段', config: {} }],
    edges: [],
  });
  assert.equal(prompt, '只用描述当指令');
});

test('extractDesignerSourcePrompt returns empty when nothing stored', () => {
  assert.equal(extractDesignerSourcePrompt(null), '');
  assert.equal(
    extractDesignerSourcePrompt({
      graph_id: 'g3',
      project_id: 'p1',
      title: 'Untitled',
      nodes: [],
      edges: [],
    }),
    '',
  );
});
