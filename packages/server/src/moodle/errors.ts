/** An error reported by Moodle itself. Its message is safe to show to the user. */
export class MoodleError extends Error {
  override name = 'MoodleError';

  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** Anything that stopped us from getting a usable answer from Moodle (network, HTTP status, bad body). */
export class MoodleTransportError extends Error {
  override name = 'MoodleTransportError';
}
