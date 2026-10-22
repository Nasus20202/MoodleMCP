import { describe, expect, it } from 'vitest';

import { McpClient, textOf } from './mcp.ts';
import {
  ALICE,
  BOB,
  COMPLETION,
  COURSE_ALG,
  COURSE_DATA,
  COURSE_DB,
  COURSE_GRADES,
  COURSES,
  DISCUSSIONS,
  GRADE_ITEMS,
  IDS,
  NOTIFICATIONS,
  POSTS,
  QUIZ_ATTEMPTS,
  QUIZ_REVIEW,
  SUBMISSION,
  UPCOMING,
  WIKI_PAGES,
} from './mock/data.ts';
import { useWorld } from './world.ts';

const SITE_INFO = 'core_webservice_get_site_info';
const alg = COURSE_DATA[COURSE_ALG];
if (!alg) throw new Error('fixture for the Algorithms course is missing');

/** Asymmetric matcher, typed so it can sit inside `expected`. */
const matching = (fields: object): unknown => expect.objectContaining(fields);

interface ToolCase {
  tool: string;
  args: Record<string, unknown>;
  /** The Moodle function behind the tool. */
  fn: string;
  /** Tools that act on "the signed-in user" first look up their id. */
  looksUpUser?: true;
  /** What the model receives, parsed from the tool's JSON text. */
  expected: unknown;
}

// One row per tool that relays a Moodle function; `read_file` has its own file.
const CASES: ToolCase[] = [
  {
    tool: 'get_site_info',
    args: {},
    fn: SITE_INFO,
    expected: matching({ userid: ALICE.id, username: 'alice', fullname: ALICE.fullname }),
  },
  {
    tool: 'list_courses',
    args: {},
    fn: 'core_enrol_get_users_courses',
    looksUpUser: true,
    // The mock user's language is English, so the multi-language markup resolves to that part.
    expected: COURSES.map((c) => (c.id === 101 ? { ...c, fullname: 'Algorithms' } : c)),
  },
  {
    tool: 'search_courses',
    args: { query: 'DATABASES' },
    fn: 'core_course_search_courses',
    expected: { total: 1, courses: [COURSES[1]] },
  },
  {
    tool: 'get_course_contents',
    args: { course_id: COURSE_ALG },
    fn: 'core_course_get_contents',
    expected: alg.contents,
  },
  {
    tool: 'get_course_module',
    args: { cmid: IDS.cmidAssign },
    fn: 'core_course_get_course_module',
    expected: {
      cm: matching({
        id: IDS.cmidAssign,
        course: COURSE_ALG,
        modname: 'assign',
        instance: IDS.assign,
      }),
      warnings: [],
    },
  },
  {
    tool: 'list_resources',
    args: { course_id: COURSE_ALG },
    fn: 'mod_resource_get_resources_by_courses',
    expected: { resources: alg.resources, warnings: [] },
  },
  {
    tool: 'list_pages',
    args: { course_id: COURSE_ALG },
    fn: 'mod_page_get_pages_by_courses',
    expected: { pages: alg.pages, warnings: [] },
  },
  {
    tool: 'list_urls',
    args: { course_id: COURSE_ALG },
    fn: 'mod_url_get_urls_by_courses',
    expected: { urls: alg.urls, warnings: [] },
  },
  {
    tool: 'list_labels',
    args: { course_id: COURSE_ALG },
    fn: 'mod_label_get_labels_by_courses',
    expected: { labels: alg.labels, warnings: [] },
  },
  {
    tool: 'list_wikis',
    args: { course_id: COURSE_ALG },
    fn: 'mod_wiki_get_wikis_by_courses',
    expected: { wikis: alg.wikis, warnings: [] },
  },
  {
    tool: 'get_wiki_pages',
    args: { wiki_id: IDS.wiki },
    fn: 'mod_wiki_get_subwiki_pages',
    expected: WIKI_PAGES,
  },
  {
    tool: 'list_assignments',
    args: { course_id: COURSE_ALG },
    fn: 'mod_assign_get_assignments',
    expected: { courses: [{ id: COURSE_ALG, assignments: alg.assignments }], warnings: [] },
  },
  {
    tool: 'get_submission_status',
    args: { assign_id: IDS.assign },
    fn: 'mod_assign_get_submission_status',
    expected: {
      ...SUBMISSION,
      lastattempt: matching({
        submission: matching({ userid: ALICE.id, status: 'submitted' }),
      }),
    },
  },
  {
    tool: 'list_quizzes',
    args: { course_id: COURSE_ALG },
    fn: 'mod_quiz_get_quizzes_by_courses',
    expected: { quizzes: alg.quizzes, warnings: [] },
  },
  {
    tool: 'get_quiz_attempts',
    args: { quiz_id: IDS.quiz },
    fn: 'mod_quiz_get_user_attempts',
    looksUpUser: true,
    expected: QUIZ_ATTEMPTS,
  },
  {
    tool: 'get_quiz_attempt_review',
    args: { attempt_id: IDS.attempt },
    fn: 'mod_quiz_get_attempt_review',
    expected: QUIZ_REVIEW,
  },
  {
    tool: 'get_upcoming_events',
    args: {},
    fn: 'core_calendar_get_calendar_upcoming_view',
    expected: UPCOMING,
  },
  {
    tool: 'get_course_events',
    args: { course_id: COURSE_ALG },
    fn: 'core_calendar_get_action_events_by_course',
    expected: { events: alg.events, firstid: 900, lastid: 900 },
  },
  {
    tool: 'get_course_completion',
    args: { course_id: COURSE_ALG },
    fn: 'core_completion_get_activities_completion_status',
    looksUpUser: true,
    expected: COMPLETION,
  },
  {
    tool: 'get_grades',
    args: { course_id: COURSE_ALG },
    fn: 'gradereport_user_get_grade_items',
    looksUpUser: true,
    expected: GRADE_ITEMS,
  },
  {
    tool: 'get_grades_overview',
    args: {},
    fn: 'gradereport_overview_get_course_grades',
    looksUpUser: true,
    expected: COURSE_GRADES,
  },
  {
    tool: 'list_forums',
    args: { course_id: COURSE_ALG },
    fn: 'mod_forum_get_forums_by_courses',
    expected: alg.forums,
  },
  {
    tool: 'list_forum_discussions',
    args: { forum_id: IDS.forum },
    fn: 'mod_forum_get_forum_discussions',
    expected: DISCUSSIONS,
  },
  {
    tool: 'get_forum_posts',
    args: { discussion_id: IDS.discussion },
    fn: 'mod_forum_get_discussion_posts',
    expected: POSTS,
  },
  {
    tool: 'get_notifications',
    args: {},
    fn: 'message_popup_get_popup_notifications',
    looksUpUser: true,
    expected: NOTIFICATIONS,
  },
];

/** The tests are only as good as their coverage: every tool the server exposes needs a row above. */
const TOOLS_COVERED_ELSEWHERE = ['read_file'];

describe('MCP tools against a mock Moodle', () => {
  const world = useWorld();
  const alice = () => McpClient.bearer(world.worker, ALICE.token);
  const bob = () => McpClient.bearer(world.worker, BOB.token);

  describe('protocol', () => {
    it('completes the MCP initialize handshake and describes the server', async () => {
      const { status, body } = await alice().rpc<{
        serverInfo: { name: string };
        capabilities: { tools?: unknown };
        instructions?: string;
      }>('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0' },
      });
      expect(status).toBe(200);
      const result = body.result;
      expect(result?.capabilities.tools).toBeDefined();
      expect(result?.instructions).toContain('Read-only');
      expect(world.moodle.requests).toHaveLength(0);
    });

    it('lists exactly the tools covered here, all marked read-only', async () => {
      const tools = await alice().listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        [...CASES.map((c) => c.tool), ...TOOLS_COVERED_ELSEWHERE].sort(),
      );
      for (const tool of tools) {
        expect(tool.description?.length, tool.name).toBeGreaterThan(40);
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      }
    });

    it('advertises the required arguments of each tool', async () => {
      const byName = new Map((await alice().listTools()).map((t) => [t.name, t]));
      for (const { tool, args } of CASES) {
        const required = byName.get(tool)?.inputSchema.required ?? [];
        expect(required.sort(), tool).toEqual(Object.keys(args).sort());
      }
    });

    it('is stateless: the same request works any number of times without a session', async () => {
      for (let i = 0; i < 3; i++) expect((await alice().rpc('tools/list')).status).toBe(200);
    });
  });

  describe.each(CASES)('$tool', ({ tool, args, fn, looksUpUser, expected }) => {
    it('returns what Moodle returned, for the signed-in user', async () => {
      const result = await alice().call(tool, args);
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(textOf(result))).toEqual(expected);
    });

    it('calls only its Moodle function (after a user lookup when it needs the user id), as the token owner', async () => {
      await alice().call(tool, args);
      expect(world.moodle.restCalls.map((r) => r.fn)).toEqual(looksUpUser ? [SITE_INFO, fn] : [fn]);
      for (const call of world.moodle.restCalls) {
        expect(call.token).toBe(ALICE.token);
        expect(call.method).toBe('POST');
        expect(call.userAgent).toMatch(/^MoodleMobile\//);
        expect(call.url.pathname).toBe('/2025/webservice/rest/server.php');
      }
      expect(world.network.stray).toEqual([]);
    });

    it.skipIf(Object.keys(args).length === 0)(
      'rejects a missing or wrongly typed argument without calling Moodle',
      async () => {
        const wrongType = Object.fromEntries(
          Object.entries(args).map(([key, value]) => [key, typeof value === 'string' ? 123 : 'x']),
        );
        for (const bad of [{}, wrongType]) {
          const { body } = await alice().rpc<{ isError?: boolean }>('tools/call', {
            name: tool,
            arguments: bad,
          });
          expect(body.result?.isError ?? body.error, JSON.stringify(bad)).toBeTruthy();
        }
        expect(world.moodle.requests).toHaveLength(0);
      },
    );
  });

  describe('how arguments reach Moodle', () => {
    it('spells array parameters the way the Moodle REST protocol expects', async () => {
      await alice().call('list_assignments', { course_id: COURSE_ALG });
      expect(world.moodle.restCalls[0]?.params).toEqual({ 'courseids[0]': String(COURSE_ALG) });
    });

    it('asks for the token owner’s own data', async () => {
      await alice().call('get_quiz_attempts', { quiz_id: IDS.quiz });
      expect(world.moodle.restCalls[1]?.params).toEqual({
        quizid: String(IDS.quiz),
        userid: String(ALICE.id),
        status: 'all',
      });
    });

    it('asks for forum posts oldest first and quiz reviews as a single page', async () => {
      await alice().call('get_forum_posts', { discussion_id: IDS.discussion });
      await alice().call('get_quiz_attempt_review', { attempt_id: IDS.attempt });
      expect(world.moodle.restCalls.map((r) => r.params)).toEqual([
        { discussionid: String(IDS.discussion), sortby: 'created', sortdirection: 'ASC' },
        { attemptid: String(IDS.attempt), page: '-1' },
      ]);
    });
  });

  describe('a model working through a course', () => {
    it('follows ids from one tool to the next, down to the text of a file', async () => {
      const client = alice();
      const courses = await client.json<typeof COURSES>('list_courses');
      const course = courses.find((c) => c.shortname === 'ALG');
      expect(course).toBeDefined();

      const sections = await client.json<
        { modules: { id: number; modname: string; instance: number; contents?: { fileurl: string }[] }[] }[]
      >('get_course_contents', { course_id: course?.id });
      const modules = sections.flatMap((s) => s.modules);
      const assign = modules.find((m) => m.modname === 'assign');
      const submission = await client.json<typeof SUBMISSION>('get_submission_status', {
        assign_id: assign?.instance,
      });
      expect(submission.feedback.gradefordisplay).toBe('8.50 / 10');

      const fileUrl = modules.find((m) => m.modname === 'resource')?.contents?.[0]?.fileurl;
      const file = await client.json<{ text: string }>('read_file', { file_url: fileUrl });
      expect(file.text).toContain('Big-O notes');
    });

    it('resolves a pasted Moodle link: the cmid in the URL leads to the instance id', async () => {
      const client = alice();
      const { cm } = await client.json<{ cm: { modname: string; instance: number } }>('get_course_module', {
        cmid: IDS.cmidAssign,
      });
      expect(cm.modname).toBe('assign');
      const status = await client.json<typeof SUBMISSION>('get_submission_status', {
        assign_id: cm.instance,
      });
      expect(status.lastattempt.submission.status).toBe('submitted');
    });

    it('lets a model reach discussions through the forum list', async () => {
      const client = alice();
      const forums = await client.json<{ id: number; type: string }[]>('list_forums', {
        course_id: COURSE_ALG,
      });
      const news = forums.find((f) => f.type === 'news');
      const discussions = await client.json<typeof DISCUSSIONS>('list_forum_discussions', {
        forum_id: news?.id,
      });
      const posts = await client.json<typeof POSTS>('get_forum_posts', {
        discussion_id: discussions.discussions[0]?.discussion,
      });
      expect(posts.posts.map((p) => p.subject)).toEqual(['Exam date', 'Re: Exam date']);
    });
  });

  describe('data of different users', () => {
    it('shows each user only their own courses', async () => {
      const [a, b] = await Promise.all([
        alice().json<{ id: number }[]>('list_courses'),
        bob().json<{ id: number }[]>('list_courses'),
      ]);
      expect(a.map((c) => c.id)).toEqual([COURSE_ALG, COURSE_DB]);
      expect(b.map((c) => c.id)).toEqual([COURSE_DB]);
    });

    it('uses the right token for each of many concurrent requests', async () => {
      const calls = Array.from({ length: 12 }, (_, i) =>
        (i % 2 === 0 ? alice() : bob()).json<{ userid: number }>('get_site_info'),
      );
      const users = (await Promise.all(calls)).map((r) => r.userid);
      expect(users).toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? ALICE.id : BOB.id)));
    });

    it('lets Moodle refuse a course the user is not enrolled in, and tells the model why', async () => {
      const result = await bob().call('get_course_contents', { course_id: COURSE_ALG });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not enrolled');
    });
  });

  describe('failures', () => {
    it('reports a Moodle exception as a tool error carrying its error code', async () => {
      const result = await alice().call('get_submission_status', { assign_id: 999 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('invalidrecord');
    });

    it('reports a revoked token as an invalid token', async () => {
      world.moodle.revoke(ALICE.token);
      const result = await alice().call('list_courses');
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('invalidtoken');
    });

    it('reports an unknown token the same way', async () => {
      const result = await McpClient.bearer(world.worker, 'not-a-real-token').call('get_site_info');
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('invalidtoken');
    });

    it('reports an unreachable Moodle without leaking internals', async () => {
      world.moodle.down = true;
      const result = await alice().call('get_site_info');
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('Moodle returned HTTP 503');
    });

    it('reports a non-JSON answer from Moodle (maintenance page, wrong URL)', async () => {
      world.moodle.override(SITE_INFO, () => new Response('<html>Maintenance</html>', { status: 200 }));
      const result = await alice().call('get_site_info');
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('Moodle returned a non-JSON response');
    });

    it('rejects an unknown tool', async () => {
      const { body } = await alice().rpc('tools/call', {
        name: 'delete_course',
        arguments: { course_id: 1 },
      });
      expect(body.error ?? (body.result as { isError?: boolean }).isError).toBeTruthy();
      expect(world.moodle.requests).toHaveLength(0);
    });
  });
});
