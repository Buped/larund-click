import type { ConnectionCallResult, ConnectionToolDefinition } from '../../types';
import { mockOrMissingAuth } from '../../mock-guard';

const SETUP = 'Add WooCommerce store URL, consumer key and consumer secret. Developer shortcut keys: DEV_WOOCOMMERCE_STORE_URL, DEV_WOOCOMMERCE_CONSUMER_KEY, DEV_WOOCOMMERCE_CONSUMER_SECRET.';

function ok(output: string, details?: Record<string, unknown>): ConnectionCallResult {
  return { success: true, output, details };
}
function err(error: string): ConnectionCallResult {
  return { success: false, output: '', error };
}

function creds(secrets: Record<string, string>): { base: string; key: string; secret: string } | null {
  const base = (secrets.WOOCOMMERCE_STORE_URL || secrets.WC_STORE_URL || '').replace(/\/+$/, '');
  const key = secrets.WOOCOMMERCE_CONSUMER_KEY || secrets.WC_CONSUMER_KEY || secrets.WOOCOMMERCE_TOKEN || '';
  const secret = secrets.WOOCOMMERCE_CONSUMER_SECRET || secrets.WC_CONSUMER_SECRET || '';
  return base && key && secret ? { base, key, secret } : null;
}

async function wcFetch(path: string, c: { base: string; key: string; secret: string }, init?: RequestInit): Promise<ConnectionCallResult> {
  try {
    const url = new URL(`${c.base}/wp-json/wc/v3${path}`);
    url.searchParams.set('consumer_key', c.key);
    url.searchParams.set('consumer_secret', c.secret);
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) return err(`woocommerce_${res.status}: ${text.slice(0, 500)}`);
    return ok(text);
  } catch (e) {
    return err(`woocommerce_request_failed: ${String(e)}`);
  }
}

function qs(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') out.set(key, String(value));
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export const woocommerceTools: ConnectionToolDefinition[] = [
  {
    name: 'woocommerce.test_connection',
    description: 'Verify WooCommerce REST API credentials by listing product metadata.',
    risk: 'external_read',
    async run(_args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.test_connection', 'woocommerce.test_connection', SETUP);
      const result = await wcFetch('/system_status', c);
      return result.success ? ok('Connected to WooCommerce.', { provider: 'woocommerce' }) : result;
    },
  },
  {
    name: 'woocommerce.list_products',
    description: 'List WooCommerce products.',
    risk: 'external_read',
    async run(args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.list_products', 'woocommerce.list_products', SETUP);
      return wcFetch(`/products${qs({ page: args.page ?? 1, per_page: args.perPage ?? 20, search: args.search, status: args.status })}`, c);
    },
  },
  {
    name: 'woocommerce.get_product',
    description: 'Get one WooCommerce product.',
    risk: 'external_read',
    async run(args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.get_product', `woocommerce.get_product ${str(args.id)}`, SETUP);
      return wcFetch(`/products/${str(args.id)}`, c);
    },
  },
  {
    name: 'woocommerce.update_product',
    description: 'Update WooCommerce product price, stock or description. Approval is required by policy.',
    risk: 'external_write',
    async run(args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.update_product', `woocommerce.update_product ${str(args.id)}`, SETUP);
      const payload = args.product ?? {
        regular_price: args.price === undefined ? undefined : String(args.price),
        stock_quantity: args.stock,
        description: args.description,
        short_description: args.shortDescription,
      };
      return wcFetch(`/products/${str(args.id)}`, c, { method: 'PUT', body: JSON.stringify(payload) });
    },
  },
  {
    name: 'woocommerce.list_orders',
    description: 'List WooCommerce orders.',
    risk: 'external_read',
    async run(args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.list_orders', 'woocommerce.list_orders', SETUP);
      return wcFetch(`/orders${qs({ page: args.page ?? 1, per_page: args.perPage ?? 20, status: args.status, after: args.after, before: args.before })}`, c);
    },
  },
  {
    name: 'woocommerce.get_order',
    description: 'Get one WooCommerce order.',
    risk: 'external_read',
    async run(args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.get_order', `woocommerce.get_order ${str(args.id)}`, SETUP);
      return wcFetch(`/orders/${str(args.id)}`, c);
    },
  },
  {
    name: 'woocommerce.update_order_status',
    description: 'Update WooCommerce order status. Approval is required by policy.',
    risk: 'external_write',
    async run(args, secrets) {
      const c = creds(secrets);
      if (!c) return mockOrMissingAuth('WooCommerce', 'woocommerce.update_order_status', `woocommerce.update_order_status ${str(args.id)}`, SETUP);
      return wcFetch(`/orders/${str(args.id)}`, c, { method: 'PUT', body: JSON.stringify({ status: str(args.status) }) });
    },
  },
];
