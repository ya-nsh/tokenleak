import { describeProject } from '@tokenleak/core';
import type { ProjectDrilldownEntry, SessionDrilldownEntry } from '@tokenleak/core';

/**
 * Display names for drill-down rows. `directory` is relative to the repo root
 * (it is `.` at the root), so it never works as a name on its own. These use
 * the same `describeProject` naming as the Explain view.
 */

type SessionNameFields = Pick<SessionDrilldownEntry, 'projectId' | 'repoRoot' | 'label' | 'sessionId'>;
type ProjectNameFields = Pick<ProjectDrilldownEntry, 'projectId' | 'repoRoot'>;

/** The project a session ran in, else its own label, else its id. */
export function sessionDisplayName(session: SessionNameFields): string {
  const project = describeProject(session.projectId, session.repoRoot);
  if (project) return project;
  const label = session.label.trim();
  return label.length > 0 ? label : session.sessionId;
}

/** A project's short name, e.g. `tokenleak` or `tokenleak@feature-branch`. */
export function projectDisplayName(project: ProjectNameFields): string {
  return describeProject(project.projectId, project.repoRoot) ?? project.projectId;
}
