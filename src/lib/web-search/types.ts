export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  rank: number;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchResultItem[];
  provider: 'openai_web_search' | 'openrouter_web_search' | 'brave' | 'tavily' | 'exa' | 'custom';
  searchedAt: string;
}

export interface WebSearchInput {
  query: string;
  locale?: string;
  country?: string;
  maxResults?: number;
  depth?: 'quick' | 'standard';
  bannedDomains?: string[];
  preferredDomains?: string[];
}

export interface WebBatchSearchInput {
  queries: string[];
  concurrency?: number;
  maxResultsPerQuery?: number;
  locale?: string;
  country?: string;
}

export interface ExtractedContactInfo {
  url: string;
  emails: string[];
  phones: string[];
  links: {
    website?: string;
    linkedin?: string;
    contact?: string;
  };
}
