import { useEffect, useState } from 'react';
import { listMentionResources } from '../../lib/mentions/resources';
import type { MentionKind, MentionResource } from '../../lib/mentions/types';

export function useMentionResources(args: {
  userId: string;
  workspaceId?: string;
  kinds?: MentionKind[];
  active: boolean;
}) {
  const [items, setItems] = useState<MentionResource[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!args.active) return;
    let alive = true;
    setLoading(true);
    listMentionResources({ userId: args.userId, workspaceId: args.workspaceId, kinds: args.kinds })
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [args.active, args.userId, args.workspaceId, args.kinds?.join('|')]);

  return { items, loading };
}
