import { create } from 'zustand';
import { generateUuidV4 } from '../../utils/uuid';
import { extractDesignerSourcePrompt } from './designerChatSync';
import type { DesignerExecutionGraph } from './executionGraphTypes';

export type DesignerChatRole = 'user' | 'assistant' | 'system';

export type DesignerChatMessageKind =
  | 'user'
  | 'thinking'
  | 'bootstrap_done'
  | 'bootstrap_error'
  | 'not_implemented';

export type DesignerChatMessage = {
  id: string;
  role: DesignerChatRole;
  content: string;
  kind: DesignerChatMessageKind;
  createdAt: number;
};

export type DesignerBootstrapPhase = 'idle' | 'thinking' | 'bootstrapping' | 'done' | 'error';

type DesignerChatStore = {
  messages: DesignerChatMessage[];
  bootstrapPhase: DesignerBootstrapPhase;
  syncedGraphId: string | null;
  reset: () => void;
  appendMessage: (message: Omit<DesignerChatMessage, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
  }) => string;
  removeMessage: (id: string) => void;
  setBootstrapPhase: (phase: DesignerBootstrapPhase) => void;
  hydrateFromGraph: (graph: DesignerExecutionGraph, doneText: string) => void;
};

export const useDesignerChatStore = create<DesignerChatStore>((set, get) => ({
  messages: [],
  bootstrapPhase: 'idle',
  syncedGraphId: null,

  reset: () => set({ messages: [], bootstrapPhase: 'idle', syncedGraphId: null }),

  appendMessage: (message) => {
    const id = message.id ?? generateUuidV4();
    const createdAt = message.createdAt ?? Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: message.role,
          content: message.content,
          kind: message.kind,
          createdAt,
        },
      ],
    }));
    return id;
  },

  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((item) => item.id !== id),
    })),

  setBootstrapPhase: (phase) => set({ bootstrapPhase: phase }),

  hydrateFromGraph: (graph, doneText) => {
    const graphId = String(graph.graph_id ?? '').trim();
    if (!graphId) return;

    const state = get();
    if (state.bootstrapPhase === 'thinking' || state.bootstrapPhase === 'bootstrapping') {
      set({ syncedGraphId: graphId });
      return;
    }

    const prompt = extractDesignerSourcePrompt(graph);
    const matchingUser = state.messages.find(
      (message) => message.kind === 'user' && message.content.trim() === prompt,
    );
    if (state.syncedGraphId === graphId && matchingUser) return;
    if (matchingUser) {
      set({ syncedGraphId: graphId });
      return;
    }
    if (!prompt) {
      set({ syncedGraphId: graphId });
      return;
    }

    const now = Date.now();
    set({
      syncedGraphId: graphId,
      bootstrapPhase: 'done',
      messages: [
        {
          id: generateUuidV4(),
          role: 'user',
          content: prompt,
          kind: 'user',
          createdAt: now,
        },
        {
          id: generateUuidV4(),
          role: 'assistant',
          content: doneText,
          kind: 'bootstrap_done',
          createdAt: now + 1,
        },
      ],
    });
  },
}));
