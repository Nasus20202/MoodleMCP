import { describe, expect, it } from 'vitest';

import { McpClient, textOf } from './mcp.ts';
import { ALICE, BOB, CONVERSATION_IDS, COURSE_ALG, COURSE_DB, TEACHER } from './mock/data.ts';
import { useWorld } from './world.ts';

interface Participants {
  total: number;
  offset: number;
  next_offset: number | null;
  participants: { id: number; fullname: string; email: string; roles: string[] }[];
}

interface Conversations {
  conversations: {
    id: number;
    type: string;
    unread_count: number;
    members: Record<string, unknown>[];
    last_messages: { text: string }[];
  }[];
}

interface Messages {
  conversation_id: number;
  next_offset: number | null;
  messages: { id: number; useridfrom: number; text: string }[];
}

describe('people and messages against a mock Moodle', () => {
  const world = useWorld({}, { clearLogs: true });
  const alice = () => McpClient.bearer(world.worker, ALICE.token);
  const bob = () => McpClient.bearer(world.worker, BOB.token);

  describe('get_course_participants', () => {
    it('lists who is enrolled with roles, without the fields nobody asked for', async () => {
      const result = await alice().json<Participants>('get_course_participants', { course_id: COURSE_ALG });
      expect(result.total).toBe(4);
      expect(result.participants[0]).toEqual({
        id: TEACHER.id,
        fullname: TEACHER.fullname,
        email: TEACHER.email,
        roles: ['Teacher'],
      });
      expect(JSON.stringify(result)).not.toMatch(/lastaccess|profileimage|gturing/);
    });

    it('finds the teachers, editing or not, and the students', async () => {
      const teachers = await alice().json<Participants>('get_course_participants', {
        course_id: COURSE_ALG,
        role: 'teachers',
      });
      expect(teachers.participants.map((p) => p.fullname)).toEqual(['Dr. Grace Turing', 'Dr. Ada Assistant']);
      const students = await alice().json<Participants>('get_course_participants', {
        course_id: COURSE_ALG,
        role: 'students',
      });
      expect(students.participants.map((p) => p.id)).toEqual([ALICE.id, BOB.id]);
    });

    it('pages the list and says where to go on', async () => {
      const first = await alice().json<Participants>('get_course_participants', {
        course_id: COURSE_ALG,
        limit: 3,
      });
      expect(first).toMatchObject({ total: 4, next_offset: 3 });
      const last = await alice().json<Participants>('get_course_participants', {
        course_id: COURSE_ALG,
        limit: 3,
        offset: 3,
      });
      expect(last.participants.map((p) => p.id)).toEqual([BOB.id]);
      expect(last.next_offset).toBeNull();
    });

    it('lets Moodle refuse a course the user is not enrolled in', async () => {
      const result = await bob().call('get_course_participants', { course_id: COURSE_ALG });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not enrolled');
      expect(COURSE_DB).toBeDefined();
    });
  });

  describe('get_user_profile', () => {
    it('shows contact details and leaves out pictures, preferences and activity times', async () => {
      const { user } = await alice().json<{ user: Record<string, unknown> }>('get_user_profile', {
        user_id: TEACHER.id,
      });
      expect(user).toMatchObject({
        id: TEACHER.id,
        email: TEACHER.email,
        phone1: '+48 123 456 789',
        department: 'Computer Science',
      });
      expect(Object.keys(user)).not.toEqual(expect.arrayContaining(['lastaccess', 'profileimageurl']));
      expect(JSON.stringify(user)).not.toMatch(/lastaccess|profileimage|preferences|gturing/);
    });

    it('says so when nobody visible has that id', async () => {
      const result = await alice().json<{ user: unknown; note: string }>('get_user_profile', {
        user_id: 999,
      });
      expect(result).toMatchObject({ user: null, note: 'No such visible user.' });
    });

    it('does not record that the profile was viewed', async () => {
      await alice().call('get_user_profile', { user_id: TEACHER.id });
      expect(world.moodle.restCalls.map((r) => r.fn)).toEqual(['core_user_get_users_by_field']);
    });
  });

  describe('messages', () => {
    it('lists only the conversations the user is in, without themself or picture links', async () => {
      const { conversations } = await alice().json<Conversations>('list_conversations');
      expect(conversations.map((c) => c.id)).toEqual([
        CONVERSATION_IDS.withTeacher,
        CONVERSATION_IDS.groupChat,
      ]);
      const direct = conversations[0];
      expect(direct).toMatchObject({ type: 'individual', unread_count: 2 });
      expect(direct?.members.map((m) => m.id)).toEqual([TEACHER.id]);
      expect(JSON.stringify(conversations)).not.toMatch(/profileimage|isonline|isblocked/);
      expect(world.moodle.restCalls.map((r) => r.fn)).toEqual([
        'core_webservice_get_site_info',
        'core_message_get_conversations',
      ]);
    });

    it('reads a conversation newest first, as the token owner, always with a limit', async () => {
      const result = await alice().json<Messages>('get_conversation_messages', {
        conversation_id: CONVERSATION_IDS.withTeacher,
        limit: 2,
      });
      expect(result.messages.map((m) => m.id)).toEqual([903, 902]);
      expect(result.next_offset).toBe(2);
      expect(world.moodle.restCalls.at(-1)?.params).toMatchObject({
        currentuserid: String(ALICE.id),
        convid: String(CONVERSATION_IDS.withTeacher),
        limitfrom: '0',
        limitnum: '2',
        newest: '1',
      });
      const rest = await alice().json<Messages>('get_conversation_messages', {
        conversation_id: CONVERSATION_IDS.withTeacher,
        limit: 2,
        offset: 2,
      });
      expect(rest.messages.map((m) => m.id)).toEqual([901]);
      expect(rest.next_offset).toBeNull();
    });

    it('refuses a conversation the user is not in, and never leaks its text', async () => {
      const result = await alice().call('get_conversation_messages', {
        conversation_id: CONVERSATION_IDS.notAMember,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('does not exist');
      expect(textOf(result)).not.toContain('SECRET');
    });

    it('leaves unread messages unread and calls nothing but reading functions', async () => {
      await alice().call('list_conversations');
      await alice().call('get_conversation_messages', { conversation_id: CONVERSATION_IDS.withTeacher });
      await alice().call('get_conversation_messages', { conversation_id: CONVERSATION_IDS.withTeacher });
      const { conversations } = await alice().json<Conversations>('list_conversations');
      expect(conversations[0]?.unread_count).toBe(2);
      for (const fn of new Set(world.moodle.restCalls.map((r) => r.fn))) {
        expect(fn).toMatch(
          /^(core_webservice_get_site_info|core_message_get_conversations?|core_message_get_conversation_messages)$/,
        );
      }
    });
  });

  it('logs sizes only: no names, emails, phone numbers or message text', async () => {
    await alice().call('get_course_participants', { course_id: COURSE_ALG });
    await alice().call('get_user_profile', { user_id: TEACHER.id });
    await alice().call('list_conversations');
    await alice().call('get_conversation_messages', { conversation_id: CONVERSATION_IDS.withTeacher });
    const logs = (await world.worker.logs()).map((l) => JSON.stringify(l)).join('\n');
    expect(logs).toContain('get_conversation_messages');
    expect(logs).not.toMatch(
      /Turing|turing@|123 456|draft by Friday|homework 1|Office hours|alice@|Alice Anderson/,
    );
    expect(logs).not.toContain(ALICE.token);
  });
});
