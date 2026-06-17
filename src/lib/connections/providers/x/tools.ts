import type { ConnectionToolDefinition, ConnectionCallResult } from '../../types';
import { xAuthFromSecrets, readToken, writeToken, xFetch } from './client';
import { xError } from './errors';

const int = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function summarizeJson(output: string, summary: string): ConnectionCallResult {
  try {
    const data = JSON.parse(output) as { data?: unknown[] | object; meta?: { result_count?: number } };
    const count = Array.isArray(data.data) ? data.data.length : data.meta?.result_count;
    return { success: true, output, details: { summary, resultCount: count, data } };
  } catch {
    return { success: true, output, details: { summary } };
  }
}

export const xTools: ConnectionToolDefinition[] = [
  {
    name: 'x.test_connection',
    description: 'Verify X credentials and report read/write/ads capabilities.',
    risk: 'external_read',
    async run(_args, secrets) {
      const auth = xAuthFromSecrets(secrets);
      if (!readToken(auth)) return xError('missing_auth', 'Add X_BEARER_TOKEN for read-only access or X_WRITE_ACCESS_TOKEN for user-context access.');

      if (auth.userAccessToken) {
        const me = await xFetch('/2/users/me?user.fields=username,name,verified', auth.userAccessToken);
        if (!me.success) return me;
        const data = JSON.parse(me.output) as { data?: { id?: string; username?: string; name?: string } };
        return {
          success: true,
          output: `Connected to X${data.data?.username ? ` as @${data.data.username}` : ''}.`,
          details: { account: data.data, readOnly: false, writeAvailable: auth.hasWriteTokens },
        };
      }

      const probe = await xFetch('/2/tweets/search/recent?query=from%3AXDevelopers&max_results=10', auth.bearerToken);
      if (!probe.success) return probe;
      return {
        success: true,
        output: 'Connected to X with read-only bearer token.',
        details: { readOnly: true, writeAvailable: false },
      };
    },
  },
  {
    name: 'x.search_recent_posts',
    description: 'Search recent public X posts (query, max_results?).',
    risk: 'external_read',
    async run(args, secrets) {
      const q = str(args.query ?? args.q);
      if (!q) return xError('validation_error', 'query is required.');
      const max = Math.min(Math.max(int(args.max_results, 10), 10), 100);
      const auth = xAuthFromSecrets(secrets);
      const r = await xFetch(`/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=${max}&tweet.fields=created_at,author_id,public_metrics`, readToken(auth));
      return r.success ? summarizeJson(r.output, `Searched recent X posts for "${q}".`) : r;
    },
  },
  {
    name: 'x.get_post',
    description: 'Get one X post by id.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.id ?? args.postId);
      if (!id) return xError('validation_error', 'post id is required.');
      const r = await xFetch(`/2/tweets/${encodeURIComponent(id)}?tweet.fields=created_at,author_id,public_metrics,conversation_id`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Fetched X post ${id}.`) : r;
    },
  },
  {
    name: 'x.get_user',
    description: 'Get an X user by id or username.',
    risk: 'external_read',
    async run(args, secrets) {
      const username = str(args.username).replace(/^@/, '');
      const id = str(args.id ?? args.userId);
      if (!username && !id) return xError('validation_error', 'username or user id is required.');
      const path = username
        ? `/2/users/by/username/${encodeURIComponent(username)}?user.fields=description,public_metrics,verified`
        : `/2/users/${encodeURIComponent(id)}?user.fields=username,description,public_metrics,verified`;
      const r = await xFetch(path, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Fetched X user ${username || id}.`) : r;
    },
  },
  {
    name: 'x.get_user_posts',
    description: 'List recent posts for an X user id.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.userId ?? args.id);
      if (!id) return xError('validation_error', 'userId is required.');
      const max = Math.min(Math.max(int(args.max_results, 10), 5), 100);
      const r = await xFetch(`/2/users/${encodeURIComponent(id)}/tweets?max_results=${max}&tweet.fields=created_at,public_metrics`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Fetched posts for X user ${id}.`) : r;
    },
  },
  {
    name: 'x.get_mentions',
    description: 'List recent mentions for an X user id.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.userId ?? args.id);
      if (!id) return xError('validation_error', 'userId is required.');
      const r = await xFetch(`/2/users/${encodeURIComponent(id)}/mentions?max_results=${Math.min(Math.max(int(args.max_results, 10), 5), 100)}`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Fetched mentions for X user ${id}.`) : r;
    },
  },
  {
    name: 'x.get_followers',
    description: 'List followers for an X user id.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.userId ?? args.id);
      if (!id) return xError('validation_error', 'userId is required.');
      const r = await xFetch(`/2/users/${encodeURIComponent(id)}/followers?max_results=${Math.min(Math.max(int(args.max_results, 100), 1), 1000)}`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Fetched followers for X user ${id}.`) : r;
    },
  },
  {
    name: 'x.get_following',
    description: 'List accounts followed by an X user id.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = str(args.userId ?? args.id);
      if (!id) return xError('validation_error', 'userId is required.');
      const r = await xFetch(`/2/users/${encodeURIComponent(id)}/following?max_results=${Math.min(Math.max(int(args.max_results, 100), 1), 1000)}`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Fetched following for X user ${id}.`) : r;
    },
  },
  {
    name: 'x.create_post',
    description: 'Create a post on X. Requires approval and a user-context token.',
    risk: 'external_send',
    async run(args, secrets) {
      const text = str(args.text ?? args.content);
      if (!text) return xError('validation_error', 'text is required.');
      const token = writeToken(xAuthFromSecrets(secrets));
      if (!token) return xError('insufficient_scope', 'Posting requires X_WRITE_ACCESS_TOKEN and X_WRITE_ACCESS_TOKEN_SECRET, not just X_BEARER_TOKEN.');
      return xFetch('/2/tweets', token, { method: 'POST', body: JSON.stringify({ text }) });
    },
  },
  {
    name: 'x.reply_to_post',
    description: 'Reply to an X post. Requires approval and a user-context token.',
    risk: 'external_send',
    async run(args, secrets) {
      const text = str(args.text ?? args.content);
      const inReplyToTweetId = str(args.inReplyToTweetId ?? args.replyToId ?? args.postId);
      if (!text || !inReplyToTweetId) return xError('validation_error', 'text and inReplyToTweetId are required.');
      const token = writeToken(xAuthFromSecrets(secrets));
      if (!token) return xError('insufficient_scope', 'Replying requires X_WRITE_ACCESS_TOKEN and X_WRITE_ACCESS_TOKEN_SECRET.');
      return xFetch('/2/tweets', token, { method: 'POST', body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyToTweetId } }) });
    },
  },
  {
    name: 'x.delete_post',
    description: 'Delete an X post. Requires strong approval and a user-context token.',
    risk: 'destructive',
    async run(args, secrets) {
      const id = str(args.id ?? args.postId);
      if (!id) return xError('validation_error', 'post id is required.');
      const token = writeToken(xAuthFromSecrets(secrets));
      if (!token) return xError('insufficient_scope', 'Deleting requires X_WRITE_ACCESS_TOKEN and X_WRITE_ACCESS_TOKEN_SECRET.');
      return xFetch(`/2/tweets/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
    },
  },
  {
    name: 'x.schedule_post',
    description: 'Schedule a post through Larund automation scheduler.',
    risk: 'external_send',
    async run(args) {
      const text = str(args.text ?? args.content);
      const scheduledFor = str(args.scheduledFor ?? args.scheduled_for);
      if (!text || !scheduledFor) return xError('validation_error', 'text and scheduledFor are required.');
      return {
        success: false,
        output: '',
        error: 'provider_error: schedule_post must be created through Larund automations so approval and read-back verification are preserved.',
        details: { provider: 'x', automationRequired: true, safeArgs: { textLength: text.length, scheduledFor } },
      };
    },
  },
  {
    name: 'x.analyze_topic',
    description: 'Collect recent posts for a topic so Larund can summarize them.',
    risk: 'external_read',
    async run(args, secrets) {
      const topic = str(args.topic ?? args.query);
      if (!topic) return xError('validation_error', 'topic is required.');
      const r = await xFetch(`/2/tweets/search/recent?query=${encodeURIComponent(topic)}&max_results=${Math.min(Math.max(int(args.max_results, 25), 10), 100)}&tweet.fields=created_at,author_id,public_metrics`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Collected X posts for topic "${topic}" for analysis.`) : r;
    },
  },
  {
    name: 'x.extract_competitor_posts',
    description: 'Fetch recent posts from competitor user ids.',
    risk: 'external_read',
    async run(args, secrets) {
      const ids = Array.isArray(args.userIds) ? args.userIds.map(String).filter(Boolean) : [];
      if (!ids.length) return xError('validation_error', 'userIds is required.');
      const auth = xAuthFromSecrets(secrets);
      const results: Record<string, unknown> = {};
      for (const id of ids.slice(0, 10)) {
        const r = await xFetch(`/2/users/${encodeURIComponent(id)}/tweets?max_results=10&tweet.fields=created_at,public_metrics`, readToken(auth));
        results[id] = r.success ? JSON.parse(r.output) : { error: r.error };
      }
      return { success: true, output: JSON.stringify(results), details: { summary: `Fetched competitor posts for ${Object.keys(results).length} X users.`, results } };
    },
  },
  {
    name: 'x.generate_content_ideas_from_posts',
    description: 'Collect recent posts for a query so Larund can generate content ideas.',
    risk: 'external_read',
    async run(args, secrets) {
      const query = str(args.query ?? args.topic);
      if (!query) return xError('validation_error', 'query is required.');
      const r = await xFetch(`/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=25&tweet.fields=created_at,public_metrics`, readToken(xAuthFromSecrets(secrets)));
      return r.success ? summarizeJson(r.output, `Collected X posts for content idea generation from "${query}".`) : r;
    },
  },
];
