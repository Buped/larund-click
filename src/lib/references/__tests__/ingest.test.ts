import { describe, expect, it } from 'vitest';
import { buildReferenceMessageContent, type ReferenceIngest } from '../ingest';

function ingest(partial: Partial<ReferenceIngest>): ReferenceIngest {
  return { textBlocks: [], imageBlocks: [], perRef: [], filesRead: [], ...partial };
}

describe('buildReferenceMessageContent', () => {
  it('returns null when there is nothing to attach', () => {
    expect(buildReferenceMessageContent(ingest({}))).toBeNull();
  });

  it('returns a plain string when there are only text blocks', () => {
    const content = buildReferenceMessageContent(ingest({ textBlocks: ['### doc\nhello'] }));
    expect(typeof content).toBe('string');
    expect(content).toContain('hello');
  });

  it('returns a multimodal array (text + image_url) for scanned-PDF page images', () => {
    const content = buildReferenceMessageContent(
      ingest({
        textBlocks: ['### Scanned document: invoice.pdf'],
        imageBlocks: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
        ],
      }),
    );
    expect(Array.isArray(content)).toBe(true);
    const arr = content as Array<{ type: string }>;
    expect(arr[0].type).toBe('text');
    expect(arr.filter((b) => b.type === 'image_url')).toHaveLength(2);
  });
});
