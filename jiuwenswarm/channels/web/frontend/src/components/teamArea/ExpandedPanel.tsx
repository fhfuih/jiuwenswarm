import { useEffect, useId, type ReactNode } from 'react';
import { useFullscreenPanel } from '../../hooks';
import { useSessionArtifactsCount } from '../ArtifactsPanel';
import { ArtifactExpandedPanel } from '../ArtifactsPanel';
import { ExpandedPanelTabs, useExpandedPanelTabs } from './ExpandedPanelTabs';

export interface ExpandedPanelProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onCollapse: () => void;
  shouldFullscreen?: boolean;
  reviewPanel?: ReactNode;
  selectedArtifactId?: string;
  onArtifactSelect?: (artifactId: string) => void;
  middleTab: { key: string; label: string; icon: ReactNode };
  showMiddleTab: boolean;
  extraTabs?: { key: string; label: string; icon: ReactNode }[];
  resolveActiveTab: (activeTab: string, artifactsCount: number, reviewPanel?: ReactNode) => string;
  renderMiddleTabContent: () => ReactNode;
  renderPlanningContent: () => ReactNode;
  renderExtraTabContent?: (tab: string) => ReactNode;
  testIdPrefix?: string;
}

export function ExpandedPanel({
  activeTab,
  onTabChange,
  onCollapse,
  shouldFullscreen,
  reviewPanel,
  selectedArtifactId,
  onArtifactSelect,
  middleTab,
  showMiddleTab,
  extraTabs = [],
  resolveActiveTab,
  renderMiddleTabContent,
  renderPlanningContent,
  renderExtraTabContent,
  testIdPrefix = 'tool-panel',
}: ExpandedPanelProps) {
  const tabPanelId = useId();
  const artifactsCount = useSessionArtifactsCount();
  const { ref: fullscreenRef, isFullscreen, toggle: toggleFullscreen, enter: enterFullscreen, exit: exitFullscreen } = useFullscreenPanel<HTMLDivElement>();

  useEffect(() => {
    if (shouldFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  }, [shouldFullscreen, enterFullscreen, exitFullscreen]);

  const resolvedTab = resolveActiveTab(activeTab, artifactsCount, reviewPanel);

  const tabs = useExpandedPanelTabs({ middleTab, showMiddleTab, extraTabs, artifactsCount, reviewPanel });

  return (
    <div ref={fullscreenRef} data-testid={`${testIdPrefix}-expanded-body`} className="flex h-full flex-col overflow-hidden bg-card">
      <ExpandedPanelTabs
        tabs={tabs}
        activeTab={resolvedTab}
        onTabChange={onTabChange}
        onCollapse={onCollapse}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        testIdPrefix={testIdPrefix}
      />

      <div
        data-testid={`${testIdPrefix}-expanded-content`}
        id={`${tabPanelId}-panel`}
        className="flex min-h-0 flex-1 overflow-hidden"
        role="tabpanel"
        aria-labelledby={`${tabPanelId}-${resolvedTab}`}
      >
        {resolvedTab === middleTab.key ? (
          renderMiddleTabContent()
        ) : extraTabs.some((tab) => tab.key === resolvedTab) && renderExtraTabContent ? (
          renderExtraTabContent(resolvedTab)
        ) : resolvedTab === 'artifacts' ? (
          <ArtifactExpandedPanel selectedArtifactId={selectedArtifactId} onSelectArtifact={onArtifactSelect ?? (() => {})} />
        ) : resolvedTab === 'review' && reviewPanel ? (
          <div data-testid={`${testIdPrefix}-review-pane`} data-variant="review" className="flex min-w-0 flex-1 overflow-hidden">
            {reviewPanel}
          </div>
        ) : (
          renderPlanningContent()
        )}
      </div>
    </div>
  );
}
