export type DocumentReferenceKind =
  | 'file'
  | 'folder'
  | 'url'
  | 'google_drive_file'
  | 'google_drive_folder'
  | 'google_doc'
  | 'google_sheet'
  | 'google_slide';

export type DocumentReferenceSource = 'user_reference' | 'tool_result' | 'connection';

export interface DocumentReference {
  id: string;
  kind: DocumentReferenceKind;
  label: string;
  path?: string;
  url?: string;
  mimeType?: string;
  source: DocumentReferenceSource;
  driveFileId?: string;
  webViewLink?: string;
  lastModified?: string;
  owner?: string;
  resolvedContentSummary?: string;
}

export interface ChatInputPayload {
  text: string;
  references: DocumentReference[];
}

export interface SavedReference {
  id: string;
  label: string;
  kind: 'local_folder' | 'local_file' | 'url' | 'google_drive_folder' | 'notion_database' | 'github_repo';
  value: string;
  description?: string;
  tags?: string[];
  enabled: boolean;
}
