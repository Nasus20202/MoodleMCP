import { describe, expect, it } from 'vitest';

import { callTool, restCalls, setup } from '../app-test-utils.ts';
import type { RecordedCall } from '../test-utils.ts';
import { ToolName } from './names.ts';

const fnOf = (call: RecordedCall) => (call.body as Record<string, string>).wsfunction;

/** A Moodle that knows the user (id 9) and answers every other function with `answer`. */
const asUser9 = (answer: unknown) => (call: RecordedCall) =>
  fnOf(call) === 'core_webservice_get_site_info' ? { userid: 9 } : answer;

const run = async (tool: string, args: Record<string, unknown>, answer: unknown) => {
  const { app, moodle, logs } = setup(asUser9(answer));
  const { body } = await callTool(app, tool, args);
  const text = body.result?.content?.[0]?.text ?? 'null';
  return { body, moodle, logs, json: () => JSON.parse(text) as Record<string, unknown> };
};

const user = (id: number, ...roles: string[]) => ({
  id,
  fullname: `User ${id}`,
  email: `u${id}@x.test`,
  roles: roles.map((shortname) => ({ shortname, name: shortname.toUpperCase() })),
});

describe('get_course_participants', () => {
  const people = [
    user(1, 'editingteacher'),
    user(2, 'teacher'),
    user(3, 'student'),
    user(4),
    user(5, 'manager'),
  ];

  it.each([
    ['all', [1, 2, 3, 4, 5]],
    ['teachers', [1, 2]],
    ['students', [3]],
  ])('role %s picks the right people', async (role, ids) => {
    const { json } = await run(ToolName.GetCourseParticipants, { course_id: 3, role }, people);
    const result = json() as { total: number; participants: { id: number }[] };
    expect(result.participants.map((p) => p.id)).toEqual(ids);
    expect(result.total).toBe(ids.length);
  });

  it('asks Moodle for the course only, and shows roles by name', async () => {
    const { json, moodle } = await run(ToolName.GetCourseParticipants, { course_id: 3, limit: 1 }, people);
    expect(restCalls(moodle)[0]?.body).toMatchObject({ courseid: '3' });
    expect(json()).toMatchObject({
      next_offset: 1,
      participants: [{ id: 1, roles: ['EDITINGTEACHER'], email: 'u1@x.test' }],
    });
  });
});

describe('get_user_profile', () => {
  it('asks for exactly one user by id, and only passes on contact fields', async () => {
    const full = { id: 5, fullname: 'A', email: 'a@x.test', phone1: '1', lastaccess: 9, preferences: [] };
    const { json, moodle } = await run(ToolName.GetUserProfile, { user_id: 5 }, [full]);
    expect(restCalls(moodle).at(-1)?.body).toMatchObject({ field: 'id', 'values[0]': '5' });
    expect(json().user).toEqual({ id: 5, fullname: 'A', email: 'a@x.test', phone1: '1' });
  });

  it('ignores a record that is not the one asked for', async () => {
    const { json } = await run(ToolName.GetUserProfile, { user_id: 5 }, [{ id: 6, fullname: 'Other' }]);
    expect(json().user).toBeNull();
  });
});

describe('messages', () => {
  it('lists conversations for the token owner, naming the kind of each', async () => {
    const { json, moodle } = await run(
      ToolName.ListConversations,
      { limit: 5, offset: 10 },
      { conversations: [{ id: 1, type: 2, name: 'G', unreadcount: null, members: [], messages: [] }] },
    );
    expect(restCalls(moodle).at(-1)?.body).toMatchObject({ userid: '9', limitfrom: '10', limitnum: '5' });
    expect(json()).toMatchObject({ conversations: [{ id: 1, type: 'group', unread_count: 0 }] });
  });

  it('reads messages as the token owner, newest first, with a limit', async () => {
    const { moodle } = await run(ToolName.GetConversationMessages, { conversation_id: 4 }, { messages: [] });
    expect(restCalls(moodle).at(-1)?.body).toMatchObject({
      currentuserid: '9',
      convid: '4',
      limitfrom: '0',
      limitnum: '30',
      newest: '1',
    });
  });

  it('never logs a name, an address or message text', async () => {
    const { logs } = await run(
      ToolName.GetConversationMessages,
      { conversation_id: 4 },
      {
        id: 4,
        members: [{ id: 1, fullname: 'SECRET-NAME' }],
        messages: [{ id: 1, useridfrom: 1, text: 'SECRET-TEXT', timecreated: 1 }],
      },
    );
    expect(logs.join('\n')).not.toMatch(/SECRET/);
  });

  it('refuses nonsense arguments without calling Moodle', async () => {
    const { app, moodle } = setup();
    for (const args of [
      { conversation_id: 0 },
      { conversation_id: 1, limit: 0 },
      { conversation_id: 1, limit: 101 },
    ]) {
      const { body } = await callTool(app, ToolName.GetConversationMessages, args);
      expect(body.result?.isError ?? body.error).toBeTruthy();
    }
    expect(moodle.calls).toHaveLength(0);
  });
});
