import { createClient } from '@supabase/supabase-js';
import { packageByTier, ucToVisibleCredits } from './credit-engine';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const PLACEHOLDERS = ['your_supabase_url_here', 'your_supabase_anon_key_here', '', undefined];

if (PLACEHOLDERS.includes(SUPABASE_URL) || PLACEHOLDERS.includes(SUPABASE_ANON)) {
  throw new Error(
    'Supabase not configured — please fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

export const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON!);

export interface UserCredits {
  uc_balance: number;
  monthly_uc_limit: number;
  tier: string;
  visible_balance: number;
  monthly_credit_limit: number;
}

export async function getUserCredits(userId: string): Promise<UserCredits | null> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('uc_balance, monthly_uc_limit, tier')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  const raw = data as Pick<UserCredits, 'uc_balance' | 'monthly_uc_limit' | 'tier'>;
  const pkg = packageByTier(raw.tier);
  return {
    ...raw,
    visible_balance: ucToVisibleCredits(raw.uc_balance),
    monthly_credit_limit: pkg.monthlyOcAllowance || ucToVisibleCredits(raw.monthly_uc_limit),
  };
}
