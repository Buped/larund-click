import { PageFrame, PageHeader } from '../pages/ui';
import { SkillDirectory } from './SkillDirectory';

export function SkillsPage({ userId, projectId }: { userId: string; projectId?: string | null }) {
  return (
    <PageFrame>
      <PageHeader title="Skills" subtitle="Teach Larund reusable ways to work." />
      <SkillDirectory userId={userId} projectId={projectId} />
    </PageFrame>
  );
}
