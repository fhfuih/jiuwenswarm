import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  designerActivityItems,
  designerActivityLines,
  designerActivityText,
  isDesignerLeaderNodeId,
  localizeRunLeaderPeek,
  RUN_LEADER_EDIT_TEXTS,
  runLeaderActivityKey,
} from '../node_modules/.cache/designer-activity/designerActivity.js';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const lookup = (messages, key) => key.split('.').reduce((node, part) => node?.[part], messages);

test('run leader edit texts exist in the executor and both phrases are translated', () => {
  const executor = readFileSync(new URL('../../../../server/runtime/designer/executor.py', import.meta.url), 'utf8');
  for (const text of RUN_LEADER_EDIT_TEXTS) {
    assert.ok(executor.includes(`"${text}"`), `executor no longer emits ${text}`);
  }
  const locales = [readJson('../src/i18n/locales/en.json'), readJson('../src/i18n/locales/zh.json')];
  for (const key of ['designer.leader.reviewingEdits', 'designer.leader.preparing']) {
    for (const messages of locales) {
      assert.equal(typeof lookup(messages, key), 'string', `missing ${key}`);
    }
  }
});

test('run leader steps collapse to reviewing-edits or preparing', () => {
  assert.equal(runLeaderActivityKey('Director · Reading brief and storyboard edits'), 'designer.leader.reviewingEdits');
  assert.equal(runLeaderActivityKey('Director · Planning node agents (LLM)'), 'designer.leader.preparing');
  const peek = localizeRunLeaderPeek(
    {
      activity: { kind: 'stage', text: 'Director · Plan ready', at: 4 },
      activity_tail: [
        'Director · Reading brief and storyboard edits',
        'Director · Rebuilding clips from the edited storyboard (LLM)',
        'Director · Planning node agents (LLM)',
        'Director · Validating graph + locks (LLM)',
      ],
    },
    (key) => key,
  );
  assert.deepEqual(peek.activity_tail, ['designer.leader.reviewingEdits', 'designer.leader.preparing']);
  assert.equal(peek.activity.text, 'designer.leader.preparing');
});

test('leader node id is virtual', () => {
  assert.equal(isDesignerLeaderNodeId('__leader__'), true);
  assert.equal(isDesignerLeaderNodeId('n_brief'), false);
});

test('activity lines prefer tail then latest', () => {
  assert.deepEqual(
    designerActivityLines({
      activity: { kind: 'tool_call', text: 'patch', tool: 'designer_graph_patch' },
      activity_tail: ['reading brief', 'building graph'],
    }),
    ['reading brief', 'building graph'],
  );
  assert.equal(
    designerActivityText({ kind: 'tool_call', text: 'calling patch', tool: 'designer_graph_patch' }),
    'designer_graph_patch · calling patch',
  );
});

test('activity items preserve node-agent thinking and tool-call kinds', () => {
  const state = {
    activity: { kind: 'tool_call', text: 'calling call_video_model', tool: 'call_video_model', at: 3 },
    activity_tail: ['planning clip', 'call_video_model · calling call_video_model'],
    activity_log: [
      { kind: 'thinking', text: 'planning clip', at: 1 },
      { kind: 'stage', text: 'preparing references', at: 2 },
      { kind: 'tool_call', text: 'calling call_video_model', tool: 'call_video_model', at: 3 },
    ],
  };

  assert.deepEqual(designerActivityItems(state), [
    { kind: 'thinking', text: 'planning clip', tool: '', at: 1 },
    { kind: 'stage', text: 'preparing references', tool: '', at: 2 },
    { kind: 'tool_call', text: 'calling call_video_model', tool: 'call_video_model', at: 3 },
  ]);
  assert.deepEqual(designerActivityLines(state), [
    'planning clip',
    'preparing references',
    'call_video_model · calling call_video_model',
  ]);
});
