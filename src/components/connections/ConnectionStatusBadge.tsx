import { Badge } from '../pages/ui';
import type { RuntimeConnectionState } from '../../lib/connections/catalog';
import { RUNTIME_LABEL } from './connection-ui-types';

export function ConnectionStatusBadge({ state }: { state: RuntimeConnectionState }) {
  const label = RUNTIME_LABEL[state];
  return <Badge text={label.text} color={label.color} />;
}
