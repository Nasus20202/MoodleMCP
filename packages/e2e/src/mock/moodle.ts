import {
  CHOICE_RESULTS,
  COMPLETION,
  CONVERSATIONS,
  COURSE_DATA,
  COURSE_GRADES,
  COURSES,
  DISCUSSIONS,
  ENROLLED_USERS,
  ENROLMENTS,
  FEEDBACK_ANALYSIS,
  FILES,
  GLOSSARY_ENTRIES,
  GRADE_ITEMS,
  IDS,
  LESSON_PAGES,
  memberOf,
  type MockUser,
  NOTIFICATIONS,
  POSTS,
  QUIZ_ATTEMPTS,
  QUIZ_REVIEW,
  SUBMISSION,
  UPCOMING,
  USER_PROFILES,
  WIKI_PAGES,
} from './data.ts';

/** A Moodle web service failure, serialised the way Moodle does (HTTP 200 with an exception body). */
export class MoodleException extends Error {
  override name = 'MoodleException';
  readonly errorcode: string;

  constructor(errorcode: string, message: string) {
    super(message);
    this.errorcode = errorcode;
  }
}

/** One request that reached the mock, with the secret-bearing parts kept for assertions. */
export interface RecordedRequest {
  method: string;
  url: URL;
  kind: 'rest' | 'ajax' | 'file' | 'other';
  /** `wsfunction` (REST) or the AJAX method name. */
  fn?: string;
  token?: string;
  userAgent: string;
  /** Form fields (REST) or the first AJAX call's arguments, minus the credentials. */
  params: Record<string, string>;
}

type Params = Record<string, string>;
type Handler = (params: Params, user: MockUser) => unknown;

const QR_METHOD = 'tool_mobile_get_tokens_for_qr_login';

/** The `courseids[0]` array parameter of REST calls. */
const courseIdsParam = (p: Params) => numberParam(p, 'courseids[0]');

function numberParam(params: Params, name: string): number {
  const value = Number(params[name]);
  if (!Number.isInteger(value))
    throw new MoodleException('invalidparameter', `Invalid parameter value detected: ${name}`);
  return value;
}

/** Only the token owner may be named in `userid`-style parameters of the "own data" functions. */
function ownUser(params: Params, name: string, user: MockUser): void {
  if (numberParam(params, name) !== user.id)
    throw new MoodleException('nopermissions', 'Sorry, but you do not currently have permissions to do that');
}

function enrolled(user: MockUser, courseId: number): void {
  if (!ENROLMENTS[user.id]?.includes(courseId))
    throw new MoodleException(
      'requireloginerror',
      'Course or activity not accessible. (You are not enrolled in this course)',
    );
}

function course(courseId: number) {
  const data = COURSE_DATA[courseId];
  if (!data) throw new MoodleException('invalidrecord', "Can't find data record in database table course.");
  return data;
}

const notFound = (table: string) =>
  new MoodleException('invalidrecord', `Can't find data record in database table ${table}.`);

/** Fixtures for the functions that take `courseids[0]` and return one list. */
function perCourse<K extends keyof (typeof COURSE_DATA)[number]>(key: K, wrapper: string): Handler {
  return (p, user) => {
    const id = courseIdsParam(p);
    enrolled(user, id);
    const items = course(id)[key];
    return wrapper === '' ? items : { [wrapper]: items, warnings: [] };
  };
}

const HANDLERS: Record<string, Handler> = {
  core_webservice_get_site_info: (_p, user) => ({
    sitename: 'Example University e-learning',
    username: user.username,
    fullname: user.fullname,
    userid: user.id,
    release: '4.5.1 (Build: 20250101)',
    version: '2024100701',
  }),
  core_enrol_get_users_courses: (p, user) => {
    ownUser(p, 'userid', user);
    return COURSES.filter((c) => ENROLMENTS[user.id]?.includes(c.id));
  },
  core_course_get_contents: (p, user) => {
    const id = numberParam(p, 'courseid');
    enrolled(user, id);
    return course(id).contents;
  },
  core_course_get_course_module: (p, user) => {
    const cmid = numberParam(p, 'cmid');
    const found = Object.entries(COURSE_DATA).flatMap(([courseId, data]) =>
      (data.contents as { modules: { id: number; name: string; modname: string; instance: number }[] }[])
        .flatMap((section) => section.modules)
        .filter((m) => m.id === cmid)
        .map((m) => ({ ...m, course: Number(courseId) })),
    )[0];
    if (!found) throw notFound('course_modules');
    enrolled(user, found.course);
    return {
      cm: {
        id: found.id,
        course: found.course,
        module: 1,
        name: found.name,
        modname: found.modname,
        instance: found.instance,
      },
      warnings: [],
    };
  },
  core_course_search_courses: (p) => {
    if (p.criterianame !== 'search')
      throw new MoodleException('invalidparameter', 'Invalid parameter value detected');
    const needle = (p.criteriavalue ?? '').toLowerCase();
    // Search sees every visible course, not only the user's own.
    const courses = COURSES.filter((c) => c.fullname.toLowerCase().includes(needle));
    return { total: courses.length, courses };
  },
  core_completion_get_activities_completion_status: (p, user) => {
    const id = numberParam(p, 'courseid');
    ownUser(p, 'userid', user);
    enrolled(user, id);
    return id === COURSES[0].id ? COMPLETION : { statuses: [], warnings: [] };
  },
  mod_assign_get_assignments: (p, user) => {
    const id = courseIdsParam(p);
    enrolled(user, id);
    return { courses: [{ id, assignments: course(id).assignments }], warnings: [] };
  },
  mod_assign_get_submission_status: (p, user) => {
    const assign = numberParam(p, 'assignid');
    if (assign !== IDS.assign) throw notFound('assign');
    enrolled(user, COURSES[0].id);
    return {
      ...SUBMISSION,
      lastattempt: {
        ...SUBMISSION.lastattempt,
        submission: { ...SUBMISSION.lastattempt.submission, userid: user.id },
      },
    };
  },
  core_calendar_get_calendar_upcoming_view: () => UPCOMING,
  core_calendar_get_action_events_by_course: (p, user) => {
    const id = numberParam(p, 'courseid');
    enrolled(user, id);
    return { events: course(id).events, firstid: 900, lastid: 900 };
  },
  gradereport_user_get_grade_items: (p, user) => {
    ownUser(p, 'userid', user);
    enrolled(user, numberParam(p, 'courseid'));
    return GRADE_ITEMS;
  },
  gradereport_overview_get_course_grades: (p, user) => {
    ownUser(p, 'userid', user);
    return COURSE_GRADES;
  },
  mod_forum_get_forums_by_courses: perCourse('forums', ''),
  mod_forum_get_forum_discussions: (p, user) => {
    const forum = numberParam(p, 'forumid');
    const owner = Object.entries(COURSE_DATA).find(([, d]) =>
      (d.forums as { id: number }[]).some((f) => f.id === forum),
    );
    if (!owner) throw notFound('forum');
    enrolled(user, Number(owner[0]));
    return forum === IDS.forum ? DISCUSSIONS : { discussions: [], warnings: [] };
  },
  mod_forum_get_discussion_posts: (p, user) => {
    if (numberParam(p, 'discussionid') !== IDS.discussion) throw notFound('forum_discussions');
    if (p.sortby !== 'created' || p.sortdirection !== 'ASC')
      throw new MoodleException('invalidparameter', 'Invalid sort');
    enrolled(user, POSTS.courseid);
    return POSTS;
  },
  mod_page_get_pages_by_courses: perCourse('pages', 'pages'),
  mod_resource_get_resources_by_courses: perCourse('resources', 'resources'),
  mod_url_get_urls_by_courses: perCourse('urls', 'urls'),
  mod_label_get_labels_by_courses: perCourse('labels', 'labels'),
  mod_wiki_get_wikis_by_courses: perCourse('wikis', 'wikis'),
  mod_glossary_get_glossaries_by_courses: perCourse('glossaries', 'glossaries'),
  mod_glossary_get_entries_by_letter: (p, user) => {
    if (numberParam(p, 'id') !== IDS.glossary) throw notFound('glossary');
    if (p.letter !== 'ALL') throw new MoodleException('invalidparameter', 'Invalid letter');
    enrolled(user, COURSES[0].id);
    return GLOSSARY_ENTRIES;
  },
  mod_lesson_get_lessons_by_courses: perCourse('lessons', 'lessons'),
  mod_lesson_get_pages: (p, user) => {
    if (numberParam(p, 'lessonid') !== IDS.lesson) throw notFound('lesson');
    enrolled(user, COURSES[0].id);
    return LESSON_PAGES;
  },
  mod_choice_get_choices_by_courses: perCourse('choices', 'choices'),
  mod_choice_get_choice_results: (p, user) => {
    if (numberParam(p, 'choiceid') !== IDS.choice) throw notFound('choice');
    enrolled(user, COURSES[0].id);
    return CHOICE_RESULTS;
  },
  mod_feedback_get_feedbacks_by_courses: perCourse('feedbacks', 'feedbacks'),
  mod_feedback_get_analysis: (p, user) => {
    if (numberParam(p, 'feedbackid') !== IDS.feedback) throw notFound('feedback');
    enrolled(user, COURSES[0].id);
    return FEEDBACK_ANALYSIS;
  },
  mod_wiki_get_subwiki_pages: (p, user) => {
    if (numberParam(p, 'wikiid') !== IDS.wiki) throw notFound('wiki');
    enrolled(user, COURSES[0].id);
    return WIKI_PAGES;
  },
  mod_quiz_get_quizzes_by_courses: perCourse('quizzes', 'quizzes'),
  mod_quiz_get_user_attempts: (p, user) => {
    if (numberParam(p, 'quizid') !== IDS.quiz) throw notFound('quiz');
    ownUser(p, 'userid', user);
    if (p.status !== 'all') throw new MoodleException('invalidparameter', 'Invalid status');
    enrolled(user, COURSES[0].id);
    return QUIZ_ATTEMPTS;
  },
  mod_quiz_get_attempt_review: (p, user) => {
    if (numberParam(p, 'attemptid') !== IDS.attempt) throw notFound('quiz_attempts');
    enrolled(user, COURSES[0].id);
    if (user.id !== QUIZ_ATTEMPTS.attempts[0]?.userid)
      throw new MoodleException('nopermissions', 'You cannot review this attempt');
    return QUIZ_REVIEW;
  },
  core_enrol_get_enrolled_users: (p, user) => {
    const id = numberParam(p, 'courseid');
    enrolled(user, id);
    return ENROLLED_USERS[id] ?? [];
  },
  core_user_get_users_by_field: (p) => {
    if (p.field !== 'id') throw new MoodleException('invalidparameter', 'Invalid field');
    const profile = USER_PROFILES[numberParam(p, 'values[0]')];
    return profile ? [profile] : [];
  },
  core_message_get_conversations: (p, user) => {
    ownUser(p, 'userid', user);
    const from = numberParam(p, 'limitfrom');
    const num = numberParam(p, 'limitnum');
    const conversations = Object.entries(CONVERSATIONS)
      .filter(([, c]) => c.members.includes(user.id))
      .map(([id, c]) => ({
        id: Number(id),
        name: c.name,
        type: c.type,
        unreadcount: c.unreadcount,
        membercount: c.members.length,
        isfavourite: false,
        members: c.members.filter((m) => m !== user.id).map(memberOf),
        messages: c.messages.slice(0, 1),
      }));
    return { conversations: conversations.slice(from, from + num) };
  },
  core_message_get_conversation_messages: (p, user) => {
    ownUser(p, 'currentuserid', user);
    const conversation = CONVERSATIONS[numberParam(p, 'convid')];
    if (!conversation?.members.includes(user.id))
      throw new MoodleException('errorconversationdoesnotexist', 'The conversation does not exist');
    const from = numberParam(p, 'limitfrom');
    const num = numberParam(p, 'limitnum');
    // Moodle treats a limit of 0 as "everything"; the tool must always ask for a page.
    if (num < 1) throw new MoodleException('invalidparameter', 'A limit is required');
    if (p.newest !== '1') throw new MoodleException('invalidparameter', 'Newest first expected');
    return {
      id: numberParam(p, 'convid'),
      members: conversation.members.map(memberOf),
      messages: conversation.messages.slice(from, from + num),
    };
  },
  message_popup_get_popup_notifications: (p, user) => {
    ownUser(p, 'useridto', user);
    return NOTIFICATIONS;
  },
};

/** The web service functions this mock implements: everything the Worker is allowed to call. */
export const IMPLEMENTED_FUNCTIONS: readonly string[] = Object.keys(HANDLERS);

export interface MockMoodleOptions {
  /** Site address including any sub-path, e.g. https://moodle.example.edu/2025. */
  url: string;
  users: readonly MockUser[];
}

/**
 * A stand-in for one Moodle site: the REST web service, the QR-login AJAX endpoint and the file server,
 * with real authentication (unknown tokens are refused as Moodle refuses them), per-user data and
 * enrolment checks. It records every request so tests can assert what the Worker sent.
 */
export class MockMoodle {
  readonly url: URL;
  readonly requests: RecordedRequest[] = [];
  /** When true the site answers with HTTP 503. */
  down = false;
  readonly #users = new Map<string, MockUser>();
  readonly #qrKeys = new Map<string, MockUser>();
  readonly #revoked = new Set<string>();
  readonly #overrides = new Map<string, Handler>();
  readonly #redirects = new Map<string, string>();

  constructor(options: MockMoodleOptions) {
    this.url = new URL(options.url);
    for (const user of options.users) this.#users.set(user.token, user);
  }

  /** Back to a pristine site: no recorded requests, nothing revoked, overridden or pending, and up. */
  reset(): void {
    this.requests.length = 0;
    this.down = false;
    this.#qrKeys.clear();
    this.#revoked.clear();
    this.#overrides.clear();
    this.#redirects.clear();
  }

  /** Makes the next QR login with this key succeed for `user`. Keys are single use, as in Moodle. */
  issueQrKey(key: string, user: MockUser): void {
    this.#qrKeys.set(key, user);
  }

  /** Moodle stops accepting the token, as when the user resets their mobile app access. */
  revoke(token: string): void {
    this.#revoked.add(token);
  }

  /** Replaces a web service function for this site. */
  override(fn: string, handler: Handler): void {
    this.#overrides.set(fn, handler);
  }

  /** Makes the file server answer a download of `path` (below the site) with a redirect. */
  redirect(path: string, to: string): void {
    this.#redirects.set(path, to);
  }

  /** The requests that called a web service function. */
  get restCalls(): RecordedRequest[] {
    return this.requests.filter((r) => r.kind === 'rest');
  }

  /** Whether `request` is addressed to this site. */
  owns(url: URL): boolean {
    const base = this.url.pathname.replace(/\/+$/, '');
    return url.origin === this.url.origin && (url.pathname === base || url.pathname.startsWith(`${base}/`));
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(this.url.pathname.replace(/\/+$/, '').length);
    const userAgent = request.headers.get('User-Agent') ?? '';
    const base = { method: request.method, url, userAgent };

    if (this.down) {
      this.requests.push({ ...base, kind: 'other', params: {} });
      return new Response('Service unavailable', { status: 503 });
    }
    if (path === '/webservice/rest/server.php' && request.method === 'POST') return this.#rest(request, base);
    if (path === '/lib/ajax/service-nologin.php' && request.method === 'POST')
      return this.#ajax(request, base);
    if (path.startsWith('/webservice/pluginfile.php/') && request.method === 'GET') {
      return this.#file(path, url, base);
    }
    this.requests.push({ ...base, kind: 'other', params: {} });
    return new Response('Not found', { status: 404 });
  }

  async #rest(
    request: Request,
    base: Pick<RecordedRequest, 'method' | 'url' | 'userAgent'>,
  ): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const {
      wstoken = '',
      wsfunction = '',
      moodlewsrestformat: _format,
      ...params
    } = Object.fromEntries(form);
    this.requests.push({ ...base, kind: 'rest', fn: wsfunction, token: wstoken, params });
    try {
      const user = this.#authenticate(wstoken);
      const handler = this.#overrides.get(wsfunction) ?? HANDLERS[wsfunction];
      // A function the service does not expose, as for anything outside the mobile web service.
      if (!handler) throw new MoodleException('accessexception', 'Access control exception');
      const result = handler(params, user);
      return result instanceof Response ? result : Response.json(result ?? null);
    } catch (error) {
      if (error instanceof MoodleException) return Response.json(exceptionBody(error));
      throw error;
    }
  }

  async #ajax(
    request: Request,
    base: Pick<RecordedRequest, 'method' | 'url' | 'userAgent'>,
  ): Promise<Response> {
    const calls = (await request.json()) as {
      methodname: string;
      args: { qrloginkey?: string; userid?: number };
    }[];
    const call = calls[0];
    const key = call?.args.qrloginkey ?? '';
    this.requests.push({
      ...base,
      kind: 'ajax',
      fn: call?.methodname ?? '',
      params: { userid: String(call?.args.userid) },
    });

    // Moodle only issues QR tokens to its own mobile app's user agent.
    const refuse = (errorcode: string, message: string) =>
      Response.json([{ error: true, exception: { errorcode, message } }]);
    if (!base.userAgent.startsWith('MoodleMobile'))
      return refuse('qrcodedisabled', 'QR login needs the mobile app');
    if (call?.methodname !== QR_METHOD) return refuse('invalidmethod', 'Unknown method');
    const user = this.#qrKeys.get(key);
    if (!user || user.id !== call.args.userid) return refuse('invalidkey', 'Invalid or expired QR login key');
    this.#qrKeys.delete(key);
    return Response.json([{ error: false, data: { token: user.token, privatetoken: 'private' } }]);
  }

  #file(path: string, url: URL, base: Pick<RecordedRequest, 'method' | 'url' | 'userAgent'>): Response {
    const token = url.searchParams.get('token') ?? '';
    this.requests.push({ ...base, kind: 'file', token, params: {} });
    // Moodle answers a refused or missing file with a JSON body and status 200.
    const refuse = (errorcode: string, message: string) => Response.json({ error: message, errorcode });
    let user: MockUser;
    try {
      user = this.#authenticate(token);
    } catch (error) {
      if (error instanceof MoodleException) return refuse(error.errorcode, error.message);
      throw error;
    }
    const redirect = this.#redirects.get(path);
    if (redirect) return new Response(null, { status: 302, headers: { Location: redirect } });
    const file = FILES[path];
    if (!file) return refuse('filenotfound', 'The file does not exist');
    if (!ENROLMENTS[user.id]?.includes(file.course))
      return refuse('requireloginerror', 'You are not enrolled in this course');
    const name = path.split('/').pop() ?? 'file';
    return new Response(file.body, {
      headers: { 'Content-Type': file.type, 'Content-Disposition': `inline; filename="${name}"` },
    });
  }

  #authenticate(token: string): MockUser {
    const user = this.#users.get(token);
    if (!user || this.#revoked.has(token))
      throw new MoodleException('invalidtoken', 'Invalid token - token not found');
    return user;
  }
}

const exceptionBody = (error: MoodleException) => ({
  exception: 'moodle_exception',
  errorcode: error.errorcode,
  message: error.message,
});

/**
 * Everything the Worker can reach. A request to any host that is not a registered Moodle site is recorded
 * as `stray` and fails, so tests can prove the Worker never contacts hosts it should not.
 */
export class MockNetwork {
  readonly sites: MockMoodle[];
  readonly stray: URL[] = [];

  constructor(...sites: MockMoodle[]) {
    this.sites = sites;
  }

  reset(): void {
    this.stray.length = 0;
    for (const site of this.sites) site.reset();
  }

  /** Pass this as the Worker's outbound service. */
  readonly fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const site = this.sites.find((s) => s.owns(url));
    if (site) return site.handle(request);
    this.stray.push(url);
    return new Response('Unknown host', { status: 502 });
  };
}
