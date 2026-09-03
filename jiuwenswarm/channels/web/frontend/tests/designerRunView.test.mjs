import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isActiveDesignerRun,
  mergeRunStatesIntoNodes,
  nodeStatusFromRun,
} from '../node_modules/.cache/designer-run-view/designerRunView.mjs';

test('isActiveDesignerRun covers running and paused only', () => {
  assert.equal(isActiveDesignerRun('running'), true);
  assert.equal(isActiveDesignerRun('paused'), true);
  assert.equal(isActiveDesignerRun('completed'), false);
  assert.equal(isActiveDesignerRun('draft'), false);
});

test('mergeRunStatesIntoNodes paints node status from run state', () => {
  const nodes = [
    { id: 'n_brief', data: { label: 'brief' } },
    { id: 'n_clip', data: { label: 'clip' } },
  ];
  const merged = mergeRunStatesIntoNodes(nodes, {
    node_states: {
      n_brief: { status: 'running' },
      n_clip: {
        status: 'completed',
        output_ref: { kind: 'video', uri: 'file:///tmp/generated_clip.mp4', label: 'generated_clip.mp4' },
        candidate_output_ref: { kind: 'video', uri: 'file:///tmp/generated_clip_2.mp4', label: 'generated_clip_2.mp4' },
      },
    },
  });
  assert.equal(nodeStatusFromRun({ node_states: { n_brief: { status: 'running' } } }, 'n_brief'), 'running');
  assert.equal(merged[0].data.status, 'running');
  assert.equal(merged[1].data.status, 'completed');
  assert.equal(merged[1].data.outputRef?.label, 'generated_clip.mp4');
  assert.equal(merged[1].data.pendingRevision, true);
});
