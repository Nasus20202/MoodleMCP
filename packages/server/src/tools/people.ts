import * as z from 'zod/v4';

import { MoodleFunction } from '../moodle/functions.ts';
import { defineCustomTool, renderResult } from './define.ts';
import { ToolName } from './names.ts';

/** Role shortnames that mean "teacher": the editing teacher and the non-editing teacher. */
const TEACHER_ROLES: ReadonlySet<string> = new Set(['editingteacher', 'teacher']);

const ROLES = ['all', 'teachers', 'students'] as const;

interface Role {
  shortname?: string;
  name?: string;
}

interface EnrolledUser {
  id: number;
  fullname?: string;
  email?: string;
  roles?: Role[];
}

/** What a participant list shows: who they are, how to reach them, and their roles. Nothing else. */
const participant = (user: EnrolledUser) => ({
  id: user.id,
  fullname: user.fullname,
  email: user.email,
  roles: (user.roles ?? []).map((role) => role.name ?? role.shortname),
});

const hasRole = (user: EnrolledUser, shortname: string) =>
  (user.roles ?? []).some((r) => r.shortname === shortname);
const isTeacher = (user: EnrolledUser) =>
  (user.roles ?? []).some((r) => TEACHER_ROLES.has(r.shortname ?? ''));

export const getCourseParticipantsTool = defineCustomTool({
  name: ToolName.GetCourseParticipants,
  description:
    'List the people enrolled in a course with their `id`, name, email (when the site shows it) and roles. ' +
    'Use `role` teachers to find who teaches the course and how to contact them. A user `id` from here is the ' +
    '`user_id` for get_user_profile. Long lists are paged with `offset` and `limit`; `total` is the full count. ' +
    'Moodle refuses this when the site does not let students see participants.',
  input: z.object({
    course_id: z
      .number()
      .int()
      .positive()
      .describe('Moodle course id: the `id` of a course from list_courses or search_courses'),
    role: z
      .enum(ROLES)
      .default('all')
      .describe('all (default), teachers (editing and non-editing) or students (the student role only)'),
    offset: z.number().int().min(0).default(0).describe('number of people to skip'),
    limit: z.number().int().min(1).max(200).default(50).describe('most people to return (default 50)'),
  }),
  async run({ client }, { course_id, role, offset, limit }) {
    const users = await client.call<EnrolledUser[]>(MoodleFunction.EnrolledUsers, { courseid: course_id });
    const wanted = users.filter((user) => {
      if (role === 'all') return true;
      return role === 'teachers' ? isTeacher(user) : hasRole(user, 'student');
    });
    return renderResult(client, {
      total: wanted.length,
      offset,
      next_offset: offset + limit < wanted.length ? offset + limit : null,
      participants: wanted.slice(offset, offset + limit).map(participant),
    });
  },
});

interface UserRecord {
  id: number;
  fullname?: string;
  email?: string;
  phone1?: string;
  phone2?: string;
  department?: string;
  institution?: string;
  city?: string;
  country?: string;
  description?: string;
}

/** The contact details of a profile; the picture links, preferences and activity times are left out. */
const profile = (user: UserRecord) => ({
  id: user.id,
  fullname: user.fullname,
  email: user.email,
  phone1: user.phone1,
  phone2: user.phone2,
  department: user.department,
  institution: user.institution,
  city: user.city,
  country: user.country,
  description: user.description,
});

export const getUserProfileTool = defineCustomTool({
  name: ToolName.GetUserProfile,
  description:
    "Show one person's contact details (name, email, phones, department, institution, city, country and " +
    'their profile text), as far as the site lets the signed-in user see them. `user_id` is the `id` of a person ' +
    'from get_course_participants or the `id` of a member in list_conversations. Does not record a profile view.',
  input: z.object({
    user_id: z
      .number()
      .int()
      .positive()
      .describe('user id: the `id` of a person from get_course_participants or list_conversations'),
  }),
  async run({ client }, { user_id }) {
    const users = await client.call<UserRecord[]>(MoodleFunction.UsersByField, {
      field: 'id',
      'values[0]': user_id,
    });
    const found = users.find((user) => user.id === user_id);
    return renderResult(
      client,
      found ? { user: profile(found) } : { user: null, note: 'No such visible user.' },
    );
  },
});

interface Member {
  id: number;
  fullname?: string;
}

interface Message {
  id: number;
  useridfrom: number;
  text?: string;
  timecreated: number;
}

interface Conversation {
  id: number;
  name?: string;
  type: number;
  unreadcount?: number | null;
  membercount?: number;
  isfavourite?: boolean;
  members?: Member[];
  messages?: Message[];
}

const member = (m: Member) => ({ id: m.id, fullname: m.fullname });
const message = (m: Message) => ({
  id: m.id,
  useridfrom: m.useridfrom,
  text: m.text,
  timecreated: m.timecreated,
});

/** Conversation types in Moodle: 1 between two people, 2 a group, 3 notes to self. */
const TYPES = { 1: 'individual', 2: 'group', 3: 'self' } as const;

const conversationInfo = (c: Conversation) => ({
  id: c.id,
  name: c.name,
  type: TYPES[c.type as keyof typeof TYPES] ?? c.type,
  unread_count: c.unreadcount ?? 0,
  member_count: c.membercount,
  members: (c.members ?? []).map(member),
  last_messages: (c.messages ?? []).map(message),
});

export const listConversationsTool = defineCustomTool({
  name: ToolName.ListConversations,
  description:
    "List the signed-in user's private and group message conversations, most recent first, with members, " +
    'the number of unread messages and the latest message. A conversation `id` is the `conversation_id` for ' +
    'get_conversation_messages. Reading does not mark anything as read. ' +
    'All timestamps are Unix seconds.',
  input: z.object({
    offset: z.number().int().min(0).default(0).describe('number of conversations to skip'),
    limit: z.number().int().min(1).max(100).default(20).describe('most conversations to return (default 20)'),
  }),
  async run({ client }, { offset, limit }) {
    const result = await client.call<{ conversations?: Conversation[] }>(MoodleFunction.Conversations, {
      userid: await client.userId(),
      limitfrom: offset,
      limitnum: limit,
    });
    return renderResult(client, { conversations: (result.conversations ?? []).map(conversationInfo) });
  },
});

export const getConversationMessagesTool = defineCustomTool({
  name: ToolName.GetConversationMessages,
  description:
    'Read the messages of one conversation, newest first. `conversation_id` is the `id` of a conversation ' +
    'from list_conversations. Page back in time with `offset` (raise it by `limit`). Reading does not mark ' +
    'messages as read or tell the sender they were seen. All timestamps are Unix seconds.',
  input: z.object({
    conversation_id: z
      .number()
      .int()
      .positive()
      .describe('conversation id: the `id` of a conversation from list_conversations'),
    offset: z.number().int().min(0).default(0).describe('number of (newest) messages to skip'),
    limit: z.number().int().min(1).max(100).default(30).describe('most messages to return (default 30)'),
  }),
  async run({ client }, { conversation_id, offset, limit }) {
    const result = await client.call<{ id?: number; members?: Member[]; messages?: Message[] }>(
      MoodleFunction.ConversationMessages,
      {
        currentuserid: await client.userId(),
        convid: conversation_id,
        limitfrom: offset,
        // Moodle reads "0" as "all of them", so a limit is always sent.
        limitnum: limit,
        newest: 1,
      },
    );
    return renderResult(client, {
      conversation_id: result.id ?? conversation_id,
      members: (result.members ?? []).map(member),
      offset,
      next_offset: (result.messages ?? []).length === limit ? offset + limit : null,
      messages: (result.messages ?? []).map(message),
    });
  },
});
