import { PageFrame, PageHeader } from '../pages/ui';
import { SkillDirectory } from './SkillDirectory';

export function SkillsPage({ userId }: { userId: string }) {
  return (
    <PageFrame>
      <PageHeader title="Skills" subtitle="Teach Larund reusable ways to work." />
      <SkillDirectory userId={userId} />
    </PageFrame>
  );
}
