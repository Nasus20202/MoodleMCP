/** The parameters of an OAuth authorization request, as the client put them in the query string. */
export function requestFields(query: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(query));
}
