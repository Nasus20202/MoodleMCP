/** Outcome of turning user input into a token. */
export type Resolution = { status: 'token'; token: string } | { status: 'needs-browser-login' };
