import type { ChatArtifactAttachment } from '../../lib/artifacts/ui';
import { PdfArtifactViewer, PreviewError } from './viewers/PdfArtifactViewer';
import { DocxArtifactViewer } from './viewers/DocxArtifactViewer';
import { PresentationArtifactViewer } from './viewers/PresentationArtifactViewer';
import { SheetArtifactViewer } from './viewers/SheetArtifactViewer';

export function ArtifactViewer({ artifact }: { artifact?: ChatArtifactAttachment }) {
  if (!artifact) {
    return <PreviewError message="Select an artifact to preview." />;
  }
  if (artifact.verification?.exists === false) {
    return <PreviewError message="File missing. Regenerate the artifact or remove it from the conversation." />;
  }
  if (artifact.status === 'failed' || artifact.status === 'blocked') {
    return <PreviewError message={artifact.verification?.errors?.join(', ') || `Artifact ${artifact.status}.`} />;
  }
  if (artifact.kind === 'pdf') return <PdfArtifactViewer artifact={artifact} />;
  if (artifact.kind === 'docx') return <DocxArtifactViewer artifact={artifact} />;
  if (artifact.kind === 'pptx') return <PresentationArtifactViewer artifact={artifact} />;
  if (artifact.kind === 'xlsx' || artifact.kind === 'csv') return <SheetArtifactViewer artifact={artifact} />;
  return <PreviewError message="Preview unavailable, but the file was created. Use Open or Save copy." />;
}
