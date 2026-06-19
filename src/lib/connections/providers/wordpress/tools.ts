// WordPress tools — real REST calls (no mocks). Risk per tool drives the approval
// policy: reads run automatically, writes ask, publish is external_send (always ask).
// Outputs are concise and non-secret; IDs/links are included so the audit log records
// real evidence and the agent can read the result back.

import type { ConnectionToolDefinition } from '../../types';
import type { ConnectionCallResult } from '../../../tools/types';
import { wpRequest, wpAuthMissing, ok } from './client';

const notConnected = (): ConnectionCallResult => ({
  success: false,
  output: '',
  error: 'wordpress_not_connected: connect a site (URL + username + application password) first.',
});

function fail(status: number, json: unknown, body: string): ConnectionCallResult {
  const message = (json as { message?: string })?.message ?? body.slice(0, 200);
  return { success: false, output: '', error: `wordpress_api_${status}: ${message}` };
}

type Post = { id?: number; link?: string; status?: string; title?: { rendered?: string }; featured_media?: number };

function postSummary(p: Post): string {
  const title = p.title?.rendered ?? '(no title)';
  return `#${p.id} "${title}" status=${p.status ?? '?'} ${p.link ?? ''}`.trim();
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const wordpressTools: ConnectionToolDefinition[] = [
  {
    name: 'wordpress.test_connection',
    description: 'Verify the WordPress site URL + application password and report the signed-in user.',
    risk: 'external_read',
    async run(_args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const me = await wpRequest(secrets, 'GET', '/wp/v2/users/me?context=edit');
      if (!ok(me.status)) return fail(me.status, me.json, me.body);
      const u = me.json as { name?: string; slug?: string; capabilities?: Record<string, boolean> };
      const canPublish = Boolean(u.capabilities?.publish_posts);
      return { success: true, output: `Connected to WordPress as ${u.name ?? u.slug ?? 'user'} (publish_posts=${canPublish}).`, details: { user: u.name, canPublish } };
    },
  },
  {
    name: 'wordpress.get_site_info',
    description: 'Read site name, description and REST namespaces.',
    risk: 'external_read',
    async run(_args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const r = await wpRequest(secrets, 'GET', '');
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const s = r.json as { name?: string; description?: string; url?: string };
      return { success: true, output: `${s.name ?? 'WordPress site'} — ${s.description ?? ''} (${s.url ?? ''})`, details: { name: s.name, url: s.url } };
    },
  },
  {
    name: 'wordpress.list_posts',
    description: 'List recent posts (id, title, status, link). Args: status, search, per_page.',
    risk: 'external_read',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const q = new URLSearchParams({ context: 'edit', per_page: String(args.per_page ?? 10) });
      if (args.status) q.set('status', String(args.status));
      if (args.search) q.set('search', String(args.search));
      const r = await wpRequest(secrets, 'GET', `/wp/v2/posts?${q.toString()}`);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const posts = (r.json as Post[]) ?? [];
      return { success: true, output: posts.length ? posts.map(postSummary).join('\n') : 'No posts found.', details: { count: posts.length, ids: posts.map((p) => p.id) } };
    },
  },
  {
    name: 'wordpress.get_post',
    description: 'Get one post by id (read-back). Args: id.',
    risk: 'external_read',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const id = num(args.id);
      if (!id) return { success: false, output: '', error: 'missing_id' };
      const r = await wpRequest(secrets, 'GET', `/wp/v2/posts/${id}?context=edit`);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post & { content?: { rendered?: string } };
      return { success: true, output: postSummary(p), details: { id: p.id, status: p.status, link: p.link, featured_media: p.featured_media } };
    },
  },
  {
    name: 'wordpress.create_draft',
    description: 'Create a DRAFT post. Args: title, content, excerpt?, slug?, categories?, tags?. Never publishes.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const body: Record<string, unknown> = { status: 'draft', title: args.title ?? 'Untitled draft', content: args.content ?? '' };
      for (const k of ['excerpt', 'slug', 'categories', 'tags']) if (args[k] !== undefined) body[k] = args[k];
      const r = await wpRequest(secrets, 'POST', '/wp/v2/posts', body);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post;
      return { success: true, output: `Draft created: ${postSummary(p)}. Read it back with wordpress.get_post id=${p.id}.`, details: { id: p.id, status: p.status, link: p.link } };
    },
  },
  {
    name: 'wordpress.update_post',
    description: 'Update an existing post (draft fields, SEO title/slug/excerpt). Args: id, title?, content?, excerpt?, slug?, categories?, tags?. Does NOT publish — use wordpress.publish_post_with_approval.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const id = num(args.id);
      if (!id) return { success: false, output: '', error: 'missing_id' };
      const body: Record<string, unknown> = {};
      for (const k of ['title', 'content', 'excerpt', 'slug', 'categories', 'tags']) if (args[k] !== undefined) body[k] = args[k];
      // Guard: do not let update silently publish; publishing has its own gated tool.
      if (String(args.status ?? '') === 'publish') return { success: false, output: '', error: 'use_publish_tool: call wordpress.publish_post_with_approval to publish.' };
      const r = await wpRequest(secrets, 'POST', `/wp/v2/posts/${id}`, body);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post;
      return { success: true, output: `Post updated: ${postSummary(p)}. Read it back with wordpress.get_post id=${id}.`, details: { id: p.id, status: p.status, link: p.link } };
    },
  },
  {
    name: 'wordpress.publish_post_with_approval',
    description: 'Publish an existing post (sets status=publish). Requires approval. Args: id.',
    risk: 'external_send',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const id = num(args.id);
      if (!id) return { success: false, output: '', error: 'missing_id' };
      const r = await wpRequest(secrets, 'POST', `/wp/v2/posts/${id}`, { status: 'publish' });
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post;
      if (p.status !== 'publish') return { success: false, output: '', error: `publish_unverified: status is ${p.status}` };
      return { success: true, output: `Published: ${postSummary(p)}`, details: { id: p.id, status: p.status, link: p.link } };
    },
  },
  {
    name: 'wordpress.list_pages',
    description: 'List pages (id, title, status, link). Args: status, search, per_page.',
    risk: 'external_read',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const q = new URLSearchParams({ context: 'edit', per_page: String(args.per_page ?? 10) });
      if (args.status) q.set('status', String(args.status));
      if (args.search) q.set('search', String(args.search));
      const r = await wpRequest(secrets, 'GET', `/wp/v2/pages?${q.toString()}`);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const pages = (r.json as Post[]) ?? [];
      return { success: true, output: pages.length ? pages.map(postSummary).join('\n') : 'No pages found.', details: { count: pages.length } };
    },
  },
  {
    name: 'wordpress.create_page_draft',
    description: 'Create a DRAFT page. Args: title, content, slug?.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const body: Record<string, unknown> = { status: 'draft', title: args.title ?? 'Untitled page', content: args.content ?? '' };
      if (args.slug !== undefined) body.slug = args.slug;
      const r = await wpRequest(secrets, 'POST', '/wp/v2/pages', body);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post;
      return { success: true, output: `Page draft created: ${postSummary(p)}.`, details: { id: p.id, status: p.status, link: p.link } };
    },
  },
  {
    name: 'wordpress.update_page',
    description: 'Update an existing page. Args: id, title?, content?, slug?.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const id = num(args.id);
      if (!id) return { success: false, output: '', error: 'missing_id' };
      const body: Record<string, unknown> = {};
      for (const k of ['title', 'content', 'slug']) if (args[k] !== undefined) body[k] = args[k];
      const r = await wpRequest(secrets, 'POST', `/wp/v2/pages/${id}`, body);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post;
      return { success: true, output: `Page updated: ${postSummary(p)}.`, details: { id: p.id, status: p.status } };
    },
  },
  {
    name: 'wordpress.set_featured_media',
    description: 'Set a post\'s featured image to an existing media id. Args: post_id, media_id.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const postId = num(args.post_id ?? args.id);
      const mediaId = num(args.media_id ?? args.featured_media);
      if (!postId || !mediaId) return { success: false, output: '', error: 'missing_post_id_or_media_id' };
      const r = await wpRequest(secrets, 'POST', `/wp/v2/posts/${postId}`, { featured_media: mediaId });
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const p = r.json as Post;
      if (p.featured_media !== mediaId) return { success: false, output: '', error: 'featured_media_unverified' };
      return { success: true, output: `Featured media ${mediaId} set on post #${postId}.`, details: { post_id: postId, media_id: mediaId } };
    },
  },
  {
    name: 'wordpress.upload_media',
    description: 'Upload a media file. NOTE: binary upload via the text HTTP transport is not yet supported; planned via a dedicated Rust multipart command.',
    risk: 'external_write',
    async run(_args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      // Honest limitation — no mock success. Binary media upload needs a Rust
      // multipart/raw-bytes command (the curl text-body transport corrupts binaries).
      return { success: false, output: '', error: 'wordpress_media_upload_unsupported: binary upload needs a dedicated Rust multipart command (planned). Use set_featured_media with an already-uploaded media id.' };
    },
  },
  {
    name: 'wordpress.list_categories',
    description: 'List categories (id, name, count). Args: search, per_page.',
    risk: 'external_read',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const q = new URLSearchParams({ per_page: String(args.per_page ?? 50) });
      if (args.search) q.set('search', String(args.search));
      const r = await wpRequest(secrets, 'GET', `/wp/v2/categories?${q.toString()}`);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const cats = (r.json as Array<{ id?: number; name?: string; count?: number }>) ?? [];
      return { success: true, output: cats.map((c) => `#${c.id} ${c.name} (${c.count ?? 0})`).join('\n') || 'No categories.', details: { count: cats.length } };
    },
  },
  {
    name: 'wordpress.list_tags',
    description: 'List tags (id, name, count). Args: search, per_page.',
    risk: 'external_read',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      const q = new URLSearchParams({ per_page: String(args.per_page ?? 50) });
      if (args.search) q.set('search', String(args.search));
      const r = await wpRequest(secrets, 'GET', `/wp/v2/tags?${q.toString()}`);
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const tags = (r.json as Array<{ id?: number; name?: string; count?: number }>) ?? [];
      return { success: true, output: tags.map((t) => `#${t.id} ${t.name} (${t.count ?? 0})`).join('\n') || 'No tags.', details: { count: tags.length } };
    },
  },
  {
    name: 'wordpress.create_category_with_approval',
    description: 'Create a category. Requires approval. Args: name, parent?.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      if (!args.name) return { success: false, output: '', error: 'missing_name' };
      const r = await wpRequest(secrets, 'POST', '/wp/v2/categories', { name: args.name, ...(args.parent ? { parent: num(args.parent) } : {}) });
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const c = r.json as { id?: number; name?: string };
      return { success: true, output: `Category created: #${c.id} ${c.name}`, details: { id: c.id } };
    },
  },
  {
    name: 'wordpress.create_tag_with_approval',
    description: 'Create a tag. Requires approval. Args: name.',
    risk: 'external_write',
    async run(args, secrets) {
      if (wpAuthMissing(secrets)) return notConnected();
      if (!args.name) return { success: false, output: '', error: 'missing_name' };
      const r = await wpRequest(secrets, 'POST', '/wp/v2/tags', { name: args.name });
      if (!ok(r.status)) return fail(r.status, r.json, r.body);
      const t = r.json as { id?: number; name?: string };
      return { success: true, output: `Tag created: #${t.id} ${t.name}`, details: { id: t.id } };
    },
  },
];
