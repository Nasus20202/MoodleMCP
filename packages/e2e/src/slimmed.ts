/**
 * What the Worker is expected to leave of a Moodle fixture: no null, empty string, empty list or empty object
 * (`warnings: []`), and none of the fields that say nothing (text formats, people's picture links, AI-tool flags,
 * display settings, icons). Zero and false stay. Written out here on purpose, so the e2e tests state the rule
 * rather than borrow the server's code. Matchers such as `expect.objectContaining` are left alone.
 */
const NOISE =
  /^(?:profileimageurl\w*|\w+format|legacyfiles(?:last)?|enableaitools|enabledaiactions|displayoptions|modicon)$/;

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const empty = (value: unknown) =>
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (plain(value) && Object.keys(value).length === 0);

export function slimmed<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => slimmed(item as unknown)) as T;
  if (!plain(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !NOISE.test(key))
      .map(([key, item]) => [key, slimmed(item)] as const)
      .filter(([, item]) => !empty(item)),
  ) as T;
}
