export interface XPostArgs {
  text: string;
}

export interface XSearchRecentPostsArgs {
  query: string;
  max_results?: number;
}

export interface XUserArgs {
  id?: string;
  username?: string;
}
