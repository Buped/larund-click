export const PROJECT_CONTEXT_LIMITS = {
  maxSourcesPerProject: 15,
  maxUploadFilesAtOnce: 10,
  maxBytesPerTextFile: 1_000_000,
  maxCharsPerSource: 250_000,
  maxCharsPerProject: 1_500_000,
  maxChunksPerProject: 800,
  chunkTargetChars: 1800,
  chunkOverlapChars: 200,
  maxAlwaysInjectedContextChars: 12_000,
  maxRetrievedChunksPerMessage: 8,
} as const;

export const TEXT_SOURCE_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'log',
]);

export const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
]);

export const PROJECT_CONTEXT_ERRORS = {
  fileTooLarge: 'This file is too large for Project Context.',
  sourceLimit: 'This project has reached the source limit.',
  totalTextLimit: 'This project has reached the total text limit.',
  textOnly: 'Only text-based files are supported.',
  duplicate: 'This source already exists in the project.',
  binary: 'This file looks like binary data. Only text-based files are supported.',
  chunkLimit: 'This project has reached the chunk limit.',
  noProject: 'No active project is available.',
  notReady: 'Project Context is not ready yet.',
} as const;
