import { bodyLimit } from 'hono/body-limit';

import { HttpError } from './errors.ts';

/** Refuses request bodies over `maxBytes`, counting the bytes actually received, so a chunked body cannot get past it. */
export const limitBody = (maxBytes: number) =>
  bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new HttpError(413, 'Request too large');
    },
  });
