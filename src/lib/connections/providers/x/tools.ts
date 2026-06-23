import type { ConnectionToolDefinition, ConnectionCallResult } from '../../types';
import { xAuthFromSecrets, readToken, writeToken, xFetch } from './client';
import { xError } from './errors';
import {
  annotateChargedResult,
  containsUrl,
  preflightXOperation,
  unavailableXOperationMessage,
  UNAVAILABLE_OPERATIONS,
  type XOperationCode,
} from './pricing';
import { cancelScheduledXPost, createScheduledXPost, listScheduledXPosts } from './scheduled';
import { rememberXReferences, type XReferenceItem } from './references';

const int = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

function parseJson(output: string): Record<string, unknown> {
  try { return JSON.parse(output) as Record<string, unknown>; } catch { return {}; }
}

function arrayData(output: string): unknown[] {
  const parsed = parseJson(output) as { data?: unknown[] | object };
  return Array.isArray(parsed.data) ? parsed.data : parsed.data ? [parsed.data] : [];
}

function summarizeJson(output: string, summary: string, extra: Record<string, unknown> = {}): ConnectionCallResult {
  const data = parseJson(output) as { data?: unknown[] | object; meta?: { result_count?: number } };
  const count = Array.isArray(data.data) ? data.data.length : data.meta?.result_count;
  return { success: true, output, details: { summary, resultCount: count, data, ...extra } };
}

function userId(secrets: Record<string, string>): string | undefined {
  return secrets.LARUND_USER_ID || undefined;
}

function selectedAccountArg(args: Record<string, unknown>): string {
  return str(args.connectedAccountId ?? args.xAccountId ?? args.x_account_id);
}

function requireWriteToken(args: Record<string, unknown>, secrets: Record<string, string>): string | ConnectionCallResult {
  const auth = xAuthFromSecrets(secrets);
  if (auth.connectedAccountCount > 1 && !selectedAccountArg(args)) {
    return xError('validation_error', 'Több X-fiók van csatlakoztatva. Add meg, melyik fiókból menjen ki a tartalom (xAccountId / connectedAccountId).');
  }
  const token = writeToken(auth);
  if (!token) {
    return xError('insufficient_scope', 'Ehhez előbb csatlakoztatnod kell az X-fiókodat a Connections oldalon.');
  }
  return token;
}

function postReferenceItems(output: string, ownerUserId?: string): XReferenceItem[] {
  const refs: XReferenceItem[] = [];
  for (const item of arrayData(output)) {
    const p = item as { id?: string; text?: string; author_id?: string; created_at?: string };
    if (!p.id) continue;
    refs.push({
      kind: 'x_post' as const,
      refId: p.id,
      label: `X post ${p.id}`,
      detail: p.text ? p.text.slice(0, 96) : p.created_at,
      url: `https://x.com/i/web/status/${p.id}`,
      metadata: { post: p },
      userId: ownerUserId,
      cachedAt: new Date().toISOString(),
    });
  }
  return refs;
}

function userReferenceItems(output: string, ownerUserId?: string): XReferenceItem[] {
  const refs: XReferenceItem[] = [];
  for (const item of arrayData(output)) {
    const u = item as { id?: string; username?: string; name?: string; description?: string };
    if (!u.id && !u.username) continue;
    const handle = u.username ? `@${u.username}` : String(u.id);
    refs.push({
      kind: 'x_user' as const,
      refId: u.id ?? u.username ?? handle,
      label: handle,
      detail: u.name || u.description,
      url: u.username ? `https://x.com/${u.username}` : `https://x.com/i/user/${u.id}`,
      metadata: { user: u },
      userId: ownerUserId,
      cachedAt: new Date().toISOString(),
    });
  }
  return refs;
}

function rememberResultReferences(output: string, kind: 'post' | 'user', ownerUserId?: string): void {
  rememberXReferences(kind === 'post' ? postReferenceItems(output, ownerUserId) : userReferenceItems(output, ownerUserId));
}

function searchQuery(args: Record<string, unknown>): string {
  const q = str(args.query ?? args.q);
  const parts = [q];
  const fromUser = str(args.from_user ?? args.fromUser).replace(/^@/, '');
  if (fromUser) parts.push(`from:${fromUser}`);
  const lang = str(args.lang);
  if (lang) parts.push(`lang:${lang}`);
  if (bool(args.has_media ?? args.hasMedia)) parts.push('has:media');
  const since = str(args.since);
  const until = str(args.until);
  if (since) parts.push(`since:${since}`);
  if (until) parts.push(`until:${until}`);
  return parts.filter(Boolean).join(' ');
}

async function chargedFetch(args: {
  path: string;
  token: string | undefined;
  summary: string;
  operationCode: XOperationCode;
  unitCount: number;
  userId?: string;
  cacheKey?: string;
  relatedPostId?: string;
  relatedUserId?: string;
  refKind?: 'post' | 'user';
  init?: RequestInit;
}): Promise<ConnectionCallResult> {
  const result = await xFetch(args.path, args.token, args.init);
  const summarized = result.success ? summarizeJson(result.output, args.summary) : result;
  const charged = await annotateChargedResult(summarized, {
    userId: args.userId,
    operationCode: args.operationCode,
    unitCount: args.unitCount,
    cacheKey: args.cacheKey,
    relatedPostId: args.relatedPostId,
    relatedUserId: args.relatedUserId,
  });
  if (charged.success && args.refKind) rememberResultReferences(result.output, args.refKind, args.userId);
  return charged;
}

async function createPost(args: Record<string, unknown>, secrets: Record<string, string>, replyTo?: string): Promise<ConnectionCallResult> {
  const text = str(args.text ?? args.content);
  if (!text) return xError('validation_error', 'text is required.');
  const token = requireWriteToken(args, secrets);
  if (typeof token !== 'string') return token;
  const operationCode: XOperationCode = containsUrl(text) ? 'post_create_with_url' : 'post_create_standard';
  const preflight = await preflightXOperation({
    userId: userId(secrets),
    operationCode,
    confirmed: bool(args.confirmCost ?? args.confirmed),
  });
  if (!preflight.ok) return preflight.result;

  const body: Record<string, unknown> = { text };
  const replyId = replyTo || str(args.reply_to_post_id ?? args.replyToPostId ?? args.inReplyToTweetId);
  if (replyId) body.reply = { in_reply_to_tweet_id: replyId };
  const quoteId = str(args.quote_post_id ?? args.quotePostId);
  if (quoteId) body.quote_tweet_id = quoteId;
  const rawMediaIds = args.media_ids ?? args.mediaIds;
  const mediaIds = Array.isArray(rawMediaIds)
    ? rawMediaIds.map(String).filter(Boolean)
    : [];
  if (mediaIds.length) body.media = { media_ids: mediaIds };

  const result = await xFetch('/2/tweets', token, { method: 'POST', body: JSON.stringify(body) });
  const charged = await annotateChargedResult(result, {
    userId: userId(secrets),
    operationCode,
    unitCount: 1,
    cacheKey: undefined,
  });
  if (!charged.success) return charged;
  const postId = ((parseJson(charged.output) as { data?: { id?: string } }).data?.id);
  if (!postId) return charged;

  const readBack = await xFetch(`/2/tweets/${encodeURIComponent(postId)}?tweet.fields=created_at,author_id,public_metrics,conversation_id`, readToken(xAuthFromSecrets(secrets)));
  rememberResultReferences(readBack.success ? readBack.output : charged.output, 'post', userId(secrets));
  return {
    ...charged,
    output: `${charged.output}\n\nRead-back: ${readBack.success ? 'verified' : readBack.error ?? 'failed'}`,
    details: { ...(charged.details ?? {}), postId, readBack: readBack.success, readBackDetails: readBack.details },
  };
}

export const xTools: ConnectionToolDefinition[] = [
  {
    name: 'x.test_connection',
    description: 'Verify X credentials and report app-only read and user write capabilities.',
    risk: 'external_read',
    async run(_args, secrets) {
      const auth = xAuthFromSecrets(secrets);
      if (!readToken(auth)) return xError('missing_auth', 'Add X_APP_BEARER for app-only read/search or connect an X account.');

      if (auth.userAccessToken) {
        const me = await xFetch('/2/users/me?user.fields=username,name,verified,profile_image_url', auth.userAccessToken);
        if (!me.success) return me;
        const data = parseJson(me.output) as { data?: { id?: string; username?: string; name?: string } };
        rememberResultReferences(me.output, 'user', userId(secrets));
        return {
          success: true,
          output: `Connected to X${data.data?.username ? ` as @${data.data.username}` : ''}.`,
          details: { account: data.data, readOnly: false, writeAvailable: auth.hasWriteTokens },
        };
      }

      const probe = await xFetch('/2/tweets/search/recent?query=from%3AXDevelopers&max_results=10', auth.bearerToken);
      if (!probe.success) return probe;
      return { success: true, output: 'Connected to X with app-only read/search.', details: { readOnly: true, writeAvailable: false } };
    },
  },
  {
    name: 'x.search_posts',
    description: 'Search recent public X posts with optional filters. App-only read is supported; successful results are UC-billed.',
    risk: 'external_read',
    async run(args, secrets) {
      const q = searchQuery(args);
      if (!q) return xError('validation_error', 'query is required.');
      const max = Math.min(Math.max(int(args.max_results ?? args.maxResults, 10), 10), 100);
      const token = readToken(xAuthFromSecrets(secrets));
      const sort = str(args.sort);
      const endpoint = `/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=${max}&tweet.fields=created_at,author_id,public_metrics,conversation_id,attachments&expansions=author_id,attachments.media_keys&user.fields=username,name,profile_image_url,verified&media.fields=preview_image_url,url,type`;
      return chargedFetch({
        path: endpoint,
        token,
        summary: `Searched recent X posts for "${q}".`,
        operationCode: 'post_read',
        unitCount: max,
        userId: userId(secrets),
        cacheKey: `search_posts:${q}:${max}:${sort}`,
        refKind: 'post',
      });
    },
  },
  {
    name: 'x.search_recent_posts',
    description: 'Alias for x.search_posts.',
    risk: 'external_read',
    async run(args, secrets) {
      return xTools.find((t) => t.name === 'x.search_posts')!.run(args, secrets);
    },
  },
  {
    name: 'x.get_post',
    description: 'Get one X post by id. Uses the 24-hour dedup cache for billing.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.id ?? args.postId ?? args.post_id);
      if (!id) return xError('validation_error', 'post id is required.');
      return chargedFetch({
        path: `/2/tweets/${encodeURIComponent(id)}?tweet.fields=created_at,author_id,public_metrics,conversation_id,attachments&expansions=author_id,attachments.media_keys&user.fields=username,name,profile_image_url,verified&media.fields=preview_image_url,url,type`,
        token: readToken(xAuthFromSecrets(secrets)),
        summary: `Fetched X post ${id}.`,
        operationCode: 'post_read',
        unitCount: 1,
        userId: userId(secrets),
        cacheKey: `post:${id}`,
        relatedPostId: id,
        refKind: 'post',
      });
    },
  },
  {
    name: 'x.search_users',
    description: 'Resolve one or more X usernames from a query/handle. App-only read is supported; successful results are UC-billed.',
    risk: 'external_read',
    async run(args, secrets) {
      const raw = str(args.query ?? args.username ?? args.usernames).replace(/^@/, '');
      if (!raw) return xError('validation_error', 'query or username is required.');
      const usernames = raw.split(/[,\s]+/).map((x) => x.replace(/^@/, '')).filter(Boolean).slice(0, 100);
      return chargedFetch({
        path: `/2/users/by?usernames=${encodeURIComponent(usernames.join(','))}&user.fields=description,public_metrics,verified,profile_image_url`,
        token: readToken(xAuthFromSecrets(secrets)),
        summary: `Fetched X user profiles for ${usernames.join(', ')}.`,
        operationCode: 'user_read',
        unitCount: usernames.length,
        userId: userId(secrets),
        cacheKey: `users:${usernames.join(',').toLowerCase()}`,
        refKind: 'user',
      });
    },
  },
  {
    name: 'x.get_user_profile',
    description: 'Get an X user by id or username.',
    risk: 'external_read',
    async run(args, secrets) {
      const username = str(args.username ?? args.username_or_id ?? args.usernameOrId).replace(/^@/, '');
      const id = str(args.id ?? args.userId ?? args.user_id);
      if (!username && !id) return xError('validation_error', 'username or user id is required.');
      const path = username
        ? `/2/users/by/username/${encodeURIComponent(username)}?user.fields=description,public_metrics,verified,profile_image_url`
        : `/2/users/${encodeURIComponent(id)}?user.fields=username,description,public_metrics,verified,profile_image_url`;
      return chargedFetch({
        path,
        token: readToken(xAuthFromSecrets(secrets)),
        summary: `Fetched X user ${username || id}.`,
        operationCode: 'user_read',
        unitCount: 1,
        userId: userId(secrets),
        cacheKey: `user:${username || id}`.toLowerCase(),
        relatedUserId: id || username,
        refKind: 'user',
      });
    },
  },
  {
    name: 'x.get_user',
    description: 'Alias for x.get_user_profile.',
    risk: 'external_read',
    async run(args, secrets) {
      return xTools.find((t) => t.name === 'x.get_user_profile')!.run(args, secrets);
    },
  },
  {
    name: 'x.get_user_timeline',
    description: 'List recent posts for an X user id.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.userId ?? args.id ?? args.username_or_id);
      if (!id) return xError('validation_error', 'userId is required.');
      const max = Math.min(Math.max(int(args.max_results ?? args.maxResults, 10), 5), 100);
      return chargedFetch({
        path: `/2/users/${encodeURIComponent(id)}/tweets?max_results=${max}&tweet.fields=created_at,public_metrics,conversation_id,attachments`,
        token: readToken(xAuthFromSecrets(secrets)),
        summary: `Fetched posts for X user ${id}.`,
        operationCode: 'post_read',
        unitCount: max,
        userId: userId(secrets),
        cacheKey: `timeline:${id}:${max}`,
        relatedUserId: id,
        refKind: 'post',
      });
    },
  },
  {
    name: 'x.get_user_posts',
    description: 'Alias for x.get_user_timeline.',
    risk: 'external_read',
    async run(args, secrets) {
      return xTools.find((t) => t.name === 'x.get_user_timeline')!.run(args, secrets);
    },
  },
  {
    name: 'x.get_post_replies',
    description: 'Fetch recent replies in a post conversation.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.id ?? args.postId ?? args.post_id);
      if (!id) return xError('validation_error', 'post id is required.');
      const max = Math.min(Math.max(int(args.max_results ?? args.maxResults, 25), 10), 100);
      return chargedFetch({
        path: `/2/tweets/search/recent?query=${encodeURIComponent(`conversation_id:${id}`)}&max_results=${max}&tweet.fields=created_at,author_id,public_metrics,conversation_id,in_reply_to_user_id&expansions=author_id&user.fields=username,name,profile_image_url,verified`,
        token: readToken(xAuthFromSecrets(secrets)),
        summary: `Fetched replies/thread for X post ${id}.`,
        operationCode: 'post_read',
        unitCount: max,
        userId: userId(secrets),
        cacheKey: `thread:${id}:${max}`,
        relatedPostId: id,
        refKind: 'post',
      });
    },
  },
  {
    name: 'x.get_thread',
    description: 'Alias for x.get_post_replies.',
    risk: 'external_read',
    async run(args, secrets) {
      return xTools.find((t) => t.name === 'x.get_post_replies')!.run(args, secrets);
    },
  },
  {
    name: 'x.get_own_profile',
    description: 'Get the connected X account profile. Requires a connected user account.',
    risk: 'external_read',
    async run(_args, secrets) {
      const token = writeToken(xAuthFromSecrets(secrets));
      if (!token) return xError('insufficient_scope', 'Ehhez előbb csatlakoztatnod kell az X-fiókodat a Connections oldalon.');
      return chargedFetch({
        path: '/2/users/me?user.fields=username,name,description,public_metrics,verified,profile_image_url',
        token,
        summary: 'Fetched connected X account profile.',
        operationCode: 'owned_read',
        unitCount: 1,
        userId: userId(secrets),
        cacheKey: 'own_profile',
        refKind: 'user',
      });
    },
  },
  {
    name: 'x.get_own_timeline',
    description: 'Fetch the connected account timeline using owned-read pricing.',
    risk: 'external_read',
    async run(args, secrets) {
      const token = writeToken(xAuthFromSecrets(secrets));
      if (!token) return xError('insufficient_scope', 'Ehhez előbb csatlakoztatnod kell az X-fiókodat a Connections oldalon.');
      const me = await xFetch('/2/users/me', token);
      if (!me.success) return me;
      const id = (parseJson(me.output) as { data?: { id?: string } }).data?.id;
      if (!id) return xError('provider_error', 'X did not return the connected user id.');
      const max = Math.min(Math.max(int(args.max_results ?? args.maxResults, 10), 5), 100);
      return chargedFetch({
        path: `/2/users/${encodeURIComponent(id)}/tweets?max_results=${max}&tweet.fields=created_at,public_metrics,conversation_id,attachments`,
        token,
        summary: 'Fetched connected X account timeline.',
        operationCode: 'owned_read',
        unitCount: max,
        userId: userId(secrets),
        cacheKey: `own_timeline:${id}:${max}`,
        refKind: 'post',
      });
    },
  },
  {
    name: 'x.get_own_bookmarks',
    description: 'Fetch connected account bookmarks using owned-read pricing.',
    risk: 'external_read',
    async run(args, secrets) {
      const token = writeToken(xAuthFromSecrets(secrets));
      if (!token) return xError('insufficient_scope', 'Ehhez előbb csatlakoztatnod kell az X-fiókodat a Connections oldalon.');
      const me = await xFetch('/2/users/me', token);
      if (!me.success) return me;
      const id = (parseJson(me.output) as { data?: { id?: string } }).data?.id;
      if (!id) return xError('provider_error', 'X did not return the connected user id.');
      const max = Math.min(Math.max(int(args.max_results ?? args.maxResults, 10), 5), 100);
      return chargedFetch({
        path: `/2/users/${encodeURIComponent(id)}/bookmarks?max_results=${max}&tweet.fields=created_at,author_id,public_metrics`,
        token,
        summary: 'Fetched connected X account bookmarks.',
        operationCode: 'owned_read',
        unitCount: max,
        userId: userId(secrets),
        cacheKey: `own_bookmarks:${id}:${max}`,
        refKind: 'post',
      });
    },
  },
  {
    name: 'x.create_post',
    description: 'Create a post on X. Requires approval, cost confirmation for high-cost posts, and a connected user account.',
    risk: 'external_send',
    async run(args, secrets) {
      return createPost(args, secrets);
    },
  },
  {
    name: 'x.reply_to_post',
    description: 'Reply to an X post. Requires approval and a connected user account.',
    risk: 'external_send',
    async run(args, secrets) {
      const replyId = str(args.inReplyToTweetId ?? args.replyToId ?? args.postId ?? args.reply_to_post_id);
      if (!replyId) return xError('validation_error', 'reply post id is required.');
      return createPost(args, secrets, replyId);
    },
  },
  {
    name: 'x.create_thread',
    description: 'Create a thread by posting each item as a reply to the previous post.',
    risk: 'external_send',
    async run(args, secrets) {
      const posts = Array.isArray(args.posts) ? args.posts.map(String).filter(Boolean) : [];
      if (!posts.length) return xError('validation_error', 'posts is required.');
      const created: string[] = [];
      let replyTo = '';
      for (const text of posts.slice(0, 25)) {
        const result = await createPost({ ...args, text, reply_to_post_id: replyTo, confirmCost: args.confirmCost ?? args.confirmed }, secrets, replyTo);
        if (!result.success) return result;
        const id = ((parseJson(result.output.split('\n\nRead-back:')[0]) as { data?: { id?: string } }).data?.id);
        if (id) {
          created.push(id);
          replyTo = id;
        }
      }
      return { success: true, output: `Created X thread with ${created.length} posts: ${created.join(', ')}`, details: { postIds: created } };
    },
  },
  {
    name: 'x.delete_post',
    description: 'Delete one of the connected account posts. Requires strong approval.',
    risk: 'destructive',
    async run(args, secrets) {
      const id = str(args.id ?? args.postId ?? args.post_id);
      if (!id) return xError('validation_error', 'post id is required.');
      const token = requireWriteToken(args, secrets);
      if (typeof token !== 'string') return token;
      const result = await xFetch(`/2/tweets/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
      return result.success ? { ...result, output: `Deleted X post ${id}.` } : result;
    },
  },
  {
    name: 'x.schedule_post',
    description: 'Schedule a post in Larund. X has no native scheduled-post API; Larund stores the pending post for its scheduler/worker.',
    risk: 'external_send',
    async run(args, secrets) {
      const text = str(args.text ?? args.content);
      const scheduledFor = str(args.scheduledFor ?? args.scheduled_for ?? args.send_at ?? args.sendAt);
      if (!text || !scheduledFor) return xError('validation_error', 'text and scheduledFor are required.');
      const token = requireWriteToken(args, secrets);
      if (typeof token !== 'string') return token;
      const when = Date.parse(scheduledFor);
      if (!Number.isFinite(when) || when <= Date.now()) return xError('validation_error', 'scheduledFor must be a future date/time.');
      const operationCode: XOperationCode = containsUrl(text) ? 'post_create_with_url' : 'post_create_standard';
      const preflight = await preflightXOperation({
        userId: userId(secrets),
        operationCode,
        confirmed: bool(args.confirmCost ?? args.confirmed),
      });
      if (!preflight.ok) return preflight.result;
      const rawMediaRefs = args.media_refs ?? args.mediaRefs;
      const scheduled = createScheduledXPost({
        userId: userId(secrets) ?? 'local',
        xAccountId: selectedAccountArg(args) || secrets.LARUND_CONNECTED_ACCOUNT_ID,
        content: text,
        scheduledFor: new Date(when).toISOString(),
        linkedChatSessionId: str(args.linkedChatSessionId ?? args.chatSessionId),
        mediaRefs: Array.isArray(rawMediaRefs) ? rawMediaRefs.map(String) : [],
      });
      return {
        success: true,
        output: `X post scheduled for ${scheduled.scheduledFor}.`,
        details: { scheduledPost: scheduled, xBillingPreview: { operationCode, ucCost: preflight.ucCost } },
      };
    },
  },
  {
    name: 'x.list_scheduled_posts',
    description: 'List this user’s pending/sent/failed/cancelled scheduled X posts.',
    risk: 'external_read',
    async run(args, secrets) {
      const status = str(args.status) as 'pending' | 'sent' | 'failed' | 'cancelled' | '';
      const posts = listScheduledXPosts(userId(secrets) ?? 'local', status || undefined);
      return { success: true, output: JSON.stringify({ scheduled_posts: posts }), details: { scheduled_posts: posts, count: posts.length } };
    },
  },
  {
    name: 'x.cancel_scheduled_post',
    description: 'Cancel a pending Larund scheduled X post.',
    risk: 'destructive',
    async run(args, secrets) {
      const id = str(args.id ?? args.scheduledPostId ?? args.scheduled_post_id);
      if (!id) return xError('validation_error', 'scheduled post id is required.');
      const post = cancelScheduledXPost(userId(secrets) ?? 'local', id);
      if (!post) return xError('not_found', 'Scheduled X post was not found.');
      return { success: true, output: `Cancelled scheduled X post ${id}.`, details: { scheduledPost: post } };
    },
  },
  {
    name: 'x.upload_media',
    description: 'Prepare media for X posting. Current desktop build requires an already-uploaded media id until the Rust multipart/chunked uploader is wired.',
    risk: 'external_write',
    async run(args) {
      const path = str(args.local_path_or_drive_ref ?? args.path ?? args.driveRef);
      if (!path) return xError('validation_error', 'local_path_or_drive_ref is required.');
      return xError('provider_error', 'Media upload needs the dedicated X chunked media uploader. Attach an existing X media_id for now, or wire the Tauri multipart uploader before enabling this path.', { path });
    },
  },
  {
    name: 'x.like_post',
    description: 'Unavailable: X pay-per-use API does not expose this operation in Larund.',
    risk: 'external_send',
    async run() { return unavailableXOperationMessage('like_post'); },
  },
  {
    name: 'x.follow_user',
    description: 'Unavailable: X pay-per-use API does not expose this operation in Larund.',
    risk: 'external_send',
    async run() { return unavailableXOperationMessage('follow_user'); },
  },
  {
    name: 'x.unfollow_user',
    description: 'Unavailable: X pay-per-use API does not expose this operation in Larund.',
    risk: 'external_send',
    async run() { return unavailableXOperationMessage('unfollow_user'); },
  },
  {
    name: 'x.create_quote_post_action',
    description: 'Unavailable standalone quote action; use x.create_post with quote_post_id only where X write scopes allow it.',
    risk: 'external_send',
    async run() { return unavailableXOperationMessage('create_quote_post_action'); },
  },
  {
    name: 'x.unavailable_operations',
    description: 'List X operations intentionally disabled because they require Enterprise-level access.',
    risk: 'read_only',
    async run() {
      return { success: true, output: JSON.stringify({ unavailable: UNAVAILABLE_OPERATIONS }), details: { unavailable: UNAVAILABLE_OPERATIONS } };
    },
  },
  {
    name: 'x.analyze_topic',
    description: 'Collect recent posts for a topic so Larund can summarize them.',
    risk: 'external_read',
    async run(args, secrets) {
      return xTools.find((t) => t.name === 'x.search_posts')!.run({ ...args, query: args.topic ?? args.query, max_results: args.max_results ?? 25 }, secrets);
    },
  },
  {
    name: 'x.generate_content_ideas_from_posts',
    description: 'Collect recent posts for a query so Larund can generate content ideas.',
    risk: 'external_read',
    async run(args, secrets) {
      return xTools.find((t) => t.name === 'x.search_posts')!.run({ ...args, max_results: args.max_results ?? 25 }, secrets);
    },
  },
  {
    name: 'x.extract_competitor_posts',
    description: 'Fetch recent posts from competitor user ids.',
    risk: 'external_read',
    async run(args, secrets) {
      const ids = Array.isArray(args.userIds) ? args.userIds.map(String).filter(Boolean) : [];
      if (!ids.length) return xError('validation_error', 'userIds is required.');
      const results: Record<string, unknown> = {};
      for (const id of ids.slice(0, 10)) {
        const r = await xTools.find((t) => t.name === 'x.get_user_timeline')!.run({ userId: id, max_results: 10 }, secrets);
        results[id] = r.success ? parseJson(r.output) : { error: r.error };
      }
      return { success: true, output: JSON.stringify(results), details: { summary: `Fetched competitor posts for ${Object.keys(results).length} X users.`, results } };
    },
  },
];
