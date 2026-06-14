import type { ConnectionToolDefinition } from '../../types';
import { googleSheetsTools } from './sheets';
import { googleDocsTools } from './docs';
import { googleDriveTools } from './drive';
import { googleGmailTools } from './gmail';
import { googleCalendarTools } from './calendar';

export const googleWorkspaceTools: ConnectionToolDefinition[] = [
  ...googleSheetsTools,
  ...googleDocsTools,
  ...googleDriveTools,
  ...googleGmailTools,
  ...googleCalendarTools,
];
