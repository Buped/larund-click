// Thin route wrapper — the real workflow-builder lives in components/automations.
// (The old phase3 AutomationsTab is no longer used as the main Automations UI.)
import { AutomationsPage as AutomationsBuilder } from '../automations/AutomationsPage';
import { getActiveWorkspaceId } from './ui';

export function AutomationsPage({ userId }: { userId: string }) {
  return <AutomationsBuilder userId={userId} workspaceId={getActiveWorkspaceId()} />;
}
