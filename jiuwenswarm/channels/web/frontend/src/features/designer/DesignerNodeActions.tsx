import { createContext, useContext } from 'react';

export type DesignerNodeActions = {
  inspectNode: (nodeId: string, materialIndex?: number) => void;
  rerunNode: (nodeId: string) => void;
  openRevision: (nodeId: string) => void;
  canRerun: boolean;
};

export const DesignerNodeActionsContext = createContext<DesignerNodeActions>({
  inspectNode: () => undefined,
  rerunNode: () => undefined,
  openRevision: () => undefined,
  canRerun: false,
});

export function useDesignerNodeActions(): DesignerNodeActions {
  return useContext(DesignerNodeActionsContext);
}
