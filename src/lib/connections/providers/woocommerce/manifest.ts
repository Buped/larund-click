import type { ConnectionManifest } from '../../types';
import { woocommerceTools } from './tools';

export const woocommerceManifest: ConnectionManifest = {
  id: 'woocommerce',
  name: 'WooCommerce',
  description: 'WooCommerce products and orders through the official REST API.',
  auth: { type: 'api_key', envVars: ['WOOCOMMERCE_STORE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET'] },
  risk: 'external_write',
  tools: woocommerceTools,
};
