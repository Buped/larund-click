export class DocumentReaderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'DocumentReaderError';
  }
}

export function unsupportedFormat(ext: string): DocumentReaderError {
  return new DocumentReaderError(`Unsupported document format: ${ext || '(none)'}`, 'unsupported_format');
}
