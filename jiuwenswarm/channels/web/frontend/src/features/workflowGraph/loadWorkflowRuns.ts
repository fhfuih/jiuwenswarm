import { webRequest } from '../../services/webClient';
import { useSessionStore } from '../../stores/sessionStore';
import {
  extractWorkflowRunsFromMetadata,
  mergeWorkflowRun,
  normalizeWorkflowRun,
  type WorkflowRun,
} from './workflowGraphModel';
import { extractWorkflowControlsFromMetadata } from './workflowControlModel';

interface WorkflowsListPayload {
  type?: string;
  workflows?: unknown[];
}

interface WorkflowsDetailPayload {
  type?: string;
  workflow?: unknown;
}

function mergeRuns(base: WorkflowRun[], incoming: WorkflowRun[]): WorkflowRun[] {
  const byId = new Map(base.map((run) => [run.id, run]));
  for (const run of incoming) {
    const existing = byId.get(run.id);
    byId.set(run.id, existing ? mergeWorkflowRun(existing, run) : run);
  }
  return Array.from(byId.values());
}

function parseWorkflowList(payload: unknown): WorkflowRun[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as WorkflowsListPayload;
  const items = Array.isArray(record.workflows) ? record.workflows : [];
  return items
    .map((item) => normalizeWorkflowRun(item))
    .filter((run): run is WorkflowRun => run !== null);
}

export function applyWorkflowRunsToSession(sessionId: string, incoming: WorkflowRun[]): void {
  if (!sessionId || incoming.length === 0) return;
  const store = useSessionStore.getState();
  store.ensureRuntime(sessionId);
  const current = store.runtimes[sessionId]?.workflowRuns ?? [];
  store.setWorkflowRuns(sessionId, current.length === 0 ? incoming : mergeRuns(current, incoming));
}

/** Hydrate from session metadata, then enrich via command.workflows list + get. */
export async function loadWorkflowRunsForSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<WorkflowRun[]> {
  let runs: WorkflowRun[] = [];
  const requestOptions = { signal, timeoutMs: 30_000 };

  try {
    const metadata = await webRequest<unknown>(
      'session.get_metadata',
      { session_id: sessionId },
      requestOptions,
    );
    if (signal?.aborted) return [];
    runs = extractWorkflowRunsFromMetadata(metadata);
    extractWorkflowControlsFromMetadata(metadata).forEach((spec) => {
      useSessionStore.getState().setWorkflowControl(sessionId, spec);
    });
  } catch {
    // Metadata is optional; live RPC may still have the snapshot.
  }

  try {
    const listed = await webRequest<WorkflowsListPayload>(
      'command.workflows',
      { action: 'list', session_id: sessionId },
      requestOptions,
    );
    if (signal?.aborted) return runs;
    const summaries = parseWorkflowList(listed);
    const details = await Promise.all(
      summaries.map(async (summary) => {
        try {
          const detail = await webRequest<WorkflowsDetailPayload>(
            'command.workflows',
            {
              action: 'get',
              workflow_id: summary.id,
              session_id: sessionId,
            },
            requestOptions,
          );
          return normalizeWorkflowRun(detail?.workflow) ?? summary;
        } catch {
          return summary;
        }
      }),
    );
    if (signal?.aborted) return runs;
    runs = mergeRuns(runs, details);
  } catch {
    // Older gateways reject command.workflows; metadata-only is enough for history.
  }

  return runs;
}
