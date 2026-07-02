import { ConnectionsHub } from '../connections/ConnectionsHub';
import { PageFrame } from './ui';

export function ConnectionsPage({ userId, isAdmin, projectId }: { userId: string; isAdmin: boolean; projectId?: string | null }) {
  return (
    <PageFrame>
      <ConnectionsHub
        userId={userId}
        projectId={projectId}
        isAdmin={isAdmin}
        variant="page"
        showHeader
        showSearch
        showFilters
        showUpcomingToggle
      />
    </PageFrame>
  );
}
