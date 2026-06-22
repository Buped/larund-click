// Thin route wrapper — the real workflow-builder lives in components/automations.
// (The old phase3 AutomationsTab is no longer used as the main Automations UI.)
import { AutomationsPage as AutomationsBuilder } from '../automations/AutomationsPage';

export function AutomationsPage({ userId, projectId, isAdmin, onOpenChat }: { userId: string; projectId?: string | null; isAdmin: boolean; onOpenChat?: (sessionId: string) => void }) {
  if (!isAdmin) return null;

  return <AutomationsBuilder userId={userId} workspaceId={projectId ?? undefined} onOpenChat={onOpenChat} />;
}
