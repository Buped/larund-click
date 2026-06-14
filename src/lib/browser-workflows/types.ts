// Types for the browser workflow layer. These describe what state a page is in
// (parsed from a browser.read output) so the loop and completion guard can react
// instead of naively assuming "page opened == task done".

export type PageStateKind =
  | 'login_required'
  | 'captcha'
  | 'permission_required'
  | 'wrong_page'
  | 'webapp_ready'
  | 'loaded'
  | 'unknown';

export interface PageState {
  kind: PageStateKind;
  url?: string;
  title?: string;
  signals: string[];
  /** Convenience flags for callers. */
  isManualBlocker: boolean;
}
