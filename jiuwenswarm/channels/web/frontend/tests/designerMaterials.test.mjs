import assert from 'node:assert/strict';
import test from 'node:test';

import {
  designerAssetPreviewUrl,
  designerAssetTextUrl,
  fileUriToLocalPath,
  isPlaceholderAsset,
} from '../node_modules/.cache/designer-materials/designerAssetUrl.js';
import {
  classifyDesignerOutput,
  collectDesignerMaterials,
  collectPendingRevisions,
  isEditableDesignerMaterial,
  preferredDesignerMaterial,
} from '../node_modules/.cache/designer-materials/designerMaterials.js';

test('file URI from Windows clip output becomes a file-api URL', () => {
  const uri = 'file:///C:/Users/TIAN/.jiuwenswarm/agent/workspace/generated_20260902_085817_9444.mp4';
  assert.equal(
    fileUriToLocalPath(uri),
    'C:/Users/TIAN/.jiuwenswarm/agent/workspace/generated_20260902_085817_9444.mp4',
  );
  assert.equal(
    designerAssetPreviewUrl(uri),
    '/file-api/raw-file?path=C%3A%2FUsers%2FTIAN%2F.jiuwenswarm%2Fagent%2Fworkspace%2Fgenerated_20260902_085817_9444.mp4',
  );
  assert.equal(isPlaceholderAsset(uri), false);
});

test('designer stub URIs are placeholders without preview', () => {
  const uri = 'designer://character_design/run_1/n_character';
  assert.equal(fileUriToLocalPath(uri), null);
  assert.equal(designerAssetPreviewUrl(uri), null);
  assert.equal(isPlaceholderAsset(uri), true);
});

test('collectDesignerMaterials prefers the real clip file', () => {
  const materials = collectDesignerMaterials(
    {
      nodes: [
        { id: 'n_character', type: 'image', label: '角色图' },
        { id: 'n_clip', type: 'video', label: '视频片段' },
      ],
    },
    {
      node_states: {
        n_character: {
          status: 'completed',
          output_ref: { kind: 'image', uri: 'designer://character_design/run/n_character' },
        },
        n_clip: {
          status: 'completed',
          output_ref: {
            kind: 'video',
            uri: 'file:///C:/Users/TIAN/.jiuwenswarm/agent/workspace/generated_20260902_085817_9444.mp4',
            label: 'generated_20260902_085817_9444.mp4',
          },
        },
      },
    },
  );
  assert.equal(materials.length, 2);
  assert.equal(preferredDesignerMaterial(materials)?.nodeId, 'n_clip');
  assert.ok(materials[1].previewUrl?.includes('generated_20260902_085817_9444.mp4'));
  assert.ok(materials[1].textUrl);
});

test('classifyDesignerOutput prefers modality then markdown', () => {
  assert.equal(
    classifyDesignerOutput({
      kind: 'table',
      mimeType: 'text/markdown',
      label: 'storyboard.md',
      previewUrl: '/file-api/raw-file?path=x.md',
      textUrl: '/file-api/file-content?path=x.md',
    }),
    'text',
  );
  assert.equal(
    classifyDesignerOutput({
      kind: 'video',
      mimeType: 'video/mp4',
      previewUrl: '/file-api/raw-file?path=x.mp4',
    }),
    'video',
  );
  assert.equal(classifyDesignerOutput({ placeholder: true, previewUrl: '/x' }), 'placeholder');
});

test('collectDesignerMaterials expands output_refs into one item per keyframe', () => {
  const materials = collectDesignerMaterials(
    {
      nodes: [{ id: 'n_frame', type: 'image', label: '视频帧' }],
    },
    {
      node_states: {
        n_frame: {
          status: 'completed',
          output_ref: {
            kind: 'image',
            uri: 'file:///C:/tmp/shot1.png',
            label: 'shot1.png',
          },
          output_refs: [
            { kind: 'image', uri: 'file:///C:/tmp/shot1.png', label: 'shot1.png' },
            { kind: 'image', uri: 'file:///C:/tmp/shot2.png', label: 'shot2.png' },
            { kind: 'image', uri: 'file:///C:/tmp/shot3.png', label: 'shot3.png' },
          ],
        },
      },
    },
  );
  assert.equal(materials.length, 3);
  assert.deepEqual(
    materials.map((item) => item.id),
    ['n_frame:0', 'n_frame:1', 'n_frame:2'],
  );
  assert.deepEqual(
    materials.map((item) => item.label),
    ['shot1.png', 'shot2.png', 'shot3.png'],
  );
});

test('brief and storyboard materials are editable markdown', () => {
  const materials = collectDesignerMaterials(
    {
      nodes: [
        {
          id: 'n_brief',
          type: 'text',
          label: '项目 Brief',
          config: { role: 'brief' },
        },
        {
          id: 'n_storyboard',
          type: 'table',
          label: '分镜表',
          config: { role: 'storyboard' },
        },
        {
          id: 'n_character',
          type: 'image',
          label: '角色图',
          config: { role: 'character_design' },
        },
      ],
    },
    {
      node_states: {
        n_brief: {
          status: 'completed',
          output_ref: {
            kind: 'text',
            uri: 'file:///C:/Users/TIAN/.jiuwenswarm/agent/workspace/designer_brief.md',
            label: 'designer_brief.md',
          },
        },
        n_storyboard: {
          status: 'completed',
          output_ref: {
            kind: 'table',
            uri: 'file:///C:/Users/TIAN/.jiuwenswarm/agent/workspace/designer_storyboard.md',
            label: 'designer_storyboard.md',
          },
        },
        n_character: {
          status: 'completed',
          output_ref: {
            kind: 'image',
            uri: 'file:///C:/Users/TIAN/.jiuwenswarm/agent/workspace/character.png',
            label: 'character.png',
          },
        },
      },
    },
  );
  assert.equal(materials[0].role, 'brief');
  assert.equal(materials[1].role, 'storyboard');
  assert.equal(isEditableDesignerMaterial(materials[0]), true);
  assert.equal(isEditableDesignerMaterial(materials[1]), true);
  assert.equal(isEditableDesignerMaterial(materials[2]), false);
});

test('collectPendingRevisions keeps accepted output and lists the candidate', () => {
  const revisions = collectPendingRevisions(
    {
      nodes: [
        { id: 'n_brief', type: 'text', label: '项目 Brief', config: { role: 'brief' } },
      ],
    },
    {
      node_states: {
        n_brief: {
          status: 'completed',
          output_ref: {
            kind: 'text',
            uri: 'file:///C:/tmp/brief_old.md',
            label: 'brief_old.md',
          },
          candidate_output_ref: {
            kind: 'text',
            uri: 'file:///C:/tmp/brief_new.md',
            label: 'brief_new.md',
          },
        },
      },
    },
  );
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].original[0].label, 'brief_old.md');
  assert.equal(revisions[0].incoming[0].label, 'brief_new.md');
  const materials = collectDesignerMaterials(
    { nodes: [{ id: 'n_brief', type: 'text', label: '项目 Brief', config: { role: 'brief' } }] },
    {
      node_states: {
        n_brief: {
          status: 'completed',
          output_ref: {
            kind: 'text',
            uri: 'file:///C:/tmp/brief_old.md',
            label: 'brief_old.md',
          },
          candidate_output_ref: {
            kind: 'text',
            uri: 'file:///C:/tmp/brief_new.md',
            label: 'brief_new.md',
          },
        },
      },
    },
  );
  assert.equal(materials[0].label, 'brief_old.md');
});

test('markdown file URI becomes a file-content URL', () => {
  const uri = 'file:///C:/Users/TIAN/.jiuwenswarm/agent/workspace/designer_brief_run_n_brief.md';
  assert.equal(
    designerAssetTextUrl(uri),
    '/file-api/file-content?path=C%3A%2FUsers%2FTIAN%2F.jiuwenswarm%2Fagent%2Fworkspace%2Fdesigner_brief_run_n_brief.md&encoding=auto',
  );
  assert.equal(designerAssetTextUrl('designer://brief/run/n_brief'), null);
});
