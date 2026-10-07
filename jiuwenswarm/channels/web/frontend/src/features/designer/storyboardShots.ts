import { designerAssetTextUrl } from './designerAssetUrl';
import {
  DESIGNER_NODE_ROLE_STORYBOARD,
  type DesignerExecutionGraph,
  type DesignerExecutionRun,
} from './executionGraphTypes';

export type StoryboardShot = {
  shot_no: string;
  timeline: string;
  camera: string;
  move: string;
  on_screen: string;
  character_action: string;
  speech: string;
  scene_change: string;
};

export const STORYBOARD_COLUMNS: ReadonlyArray<readonly [keyof StoryboardShot, string]> = [
  ['shot_no', 'Shot'],
  ['timeline', 'Timeline'],
  ['camera', 'Camera'],
  ['move', 'Move'],
  ['on_screen', 'On screen'],
  ['character_action', 'Character action'],
  ['speech', 'Speech'],
  ['scene_change', 'Shot consistency'],
];

const FIELD_BY_HEADER = new Map<string, keyof StoryboardShot>(
  STORYBOARD_COLUMNS.map(([field, header]) => [header.toLowerCase(), field]),
);

function emptyShot(): StoryboardShot {
  return {
    shot_no: '',
    timeline: '',
    camera: '',
    move: '',
    on_screen: '',
    character_action: '',
    speech: '',
    scene_change: '',
  };
}

function splitMarkdownRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.every((cell) => !cell || /^:?-{3,}:?$/.test(cell));
}

function headerFieldMap(cells: string[]): Map<number, keyof StoryboardShot> | null {
  const mapping = new Map<number, keyof StoryboardShot>();
  cells.forEach((cell, index) => {
    const field = FIELD_BY_HEADER.get(cell.toLowerCase());
    if (field) mapping.set(index, field);
  });
  return [...mapping.values()].includes('shot_no') ? mapping : null;
}

export function parseStoryboardShots(text: string): StoryboardShot[] {
  const shots: StoryboardShot[] = [];
  let fieldMap: Map<number, keyof StoryboardShot> | null = null;
  for (const line of (text || '').split(/\r?\n/)) {
    if (!line.includes('|')) {
      if (fieldMap) break;
      continue;
    }
    const cells = splitMarkdownRow(line);
    if (!fieldMap) {
      fieldMap = headerFieldMap(cells);
      continue;
    }
    if (isSeparator(cells)) continue;
    const shot = emptyShot();
    fieldMap.forEach((field, index) => {
      if (index < cells.length) shot[field] = cells[index];
    });
    if (!shot.shot_no) shot.shot_no = String(shots.length + 1);
    shots.push(shot);
  }
  return shots;
}

export function shotGeneratePrompt(shot: StoryboardShot): string {
  const parts: string[] = [];
  const timeline = (shot.timeline || '').trim();
  if (timeline) parts.push(`Timeline ${timeline}`);
  const fields: Array<[string, keyof StoryboardShot]> = [
    ['Camera', 'camera'],
    ['Camera move', 'move'],
    ['On screen', 'on_screen'],
    ['Character action', 'character_action'],
    ['Speech', 'speech'],
    ['Shot consistency', 'scene_change'],
  ];
  fields.forEach(([label, key]) => {
    const value = (shot[key] || '').trim();
    if (value) parts.push(`${label} ${value}`);
  });
  return parts.join('; ');
}

export function storyboardTextUrl(
  graph: DesignerExecutionGraph | null | undefined,
  run: DesignerExecutionRun | null | undefined,
): string | null {
  const node = graph?.nodes.find((item) => item.config?.role === DESIGNER_NODE_ROLE_STORYBOARD);
  if (!node) return null;
  const state = run?.node_states?.[node.id];
  const ref = state?.output_ref || node.output_ref;
  return designerAssetTextUrl(ref?.uri);
}

export async function fetchStoryboardText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}
