/** Header that selects the Moodle site per request. */
export const SITE_HEADER = 'X-Moodle-URL';

/** Alternative to `Authorization: Bearer <token>` for clients that cannot set that header. */
export const TOKEN_HEADER = 'X-Moodle-Token';

/** Moodle's built-in mobile web service. */
export const MOODLE_MOBILE_SERVICE = 'moodle_mobile_app';

/** URL scheme Moodle uses for app deep links. */
export const MOODLE_URL_SCHEME = 'moodlemobile';
