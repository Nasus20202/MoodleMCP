import { strToU8, zipSync } from 'fflate';

/** The default site of the Worker under test (`MOODLE_URL`). */
export const SITE_URL = 'https://moodle.example.edu/2025';
/** A second institution, reachable only when the Worker's host allow-list permits it. */
export const OTHER_SITE_URL = 'https://learn.other.example.org/moodle';

export interface MockUser {
  token: string;
  id: number;
  username: string;
  fullname: string;
}

export const ALICE: MockUser = {
  token: 'alice-secret-token-7f3a9c41',
  id: 42,
  username: 'alice',
  fullname: 'Alice Anderson',
};
export const BOB: MockUser = {
  token: 'bob-secret-token-5d12e8b7',
  id: 43,
  username: 'bob',
  fullname: 'Bob Brown',
};
export const OTHER_SITE_USER: MockUser = {
  token: 'carol-secret-token-90ac33f1',
  id: 7,
  username: 'carol',
  fullname: 'Carol Clark',
};

export const COURSE_ALG = 101;
export const COURSE_DB = 102;
/** Ids of the Moodle objects the tool tests walk through; each tool's input comes from another tool's output. */
export const IDS = {
  cmidAssign: 2001,
  assign: 7,
  quiz: 9,
  attempt: 55,
  forum: 3,
  discussion: 12,
  wiki: 4,
  cmidPage: 2002,
  /** A long page with a table and a pasted picture, for the get_page tests. */
  cmidBigPage: 2011,
  glossary: 60,
  lesson: 61,
  choice: 62,
  feedback: 63,
} as const;

/** Who is enrolled where: the mock refuses course data to everyone else, as Moodle does. */
export const ENROLMENTS: Record<number, readonly number[]> = {
  [ALICE.id]: [COURSE_ALG, COURSE_DB],
  [BOB.id]: [COURSE_DB],
  [OTHER_SITE_USER.id]: [COURSE_ALG],
};

const NOTES_PATH = '/webservice/pluginfile.php/301/mod_resource/content/1/notes.txt';
const PIXEL_PATH = '/webservice/pluginfile.php/316/mod_resource/content/1/pixel.png';
const SLIDES_PATH = '/webservice/pluginfile.php/302/mod_resource/content/1/slides.pdf';
export const FILE_URLS = {
  notes: `${SITE_URL}${NOTES_PATH}`,
  /** The form Moodle puts in HTML content: the Worker must rewrite it to the web service file server. */
  notesPlain: `${SITE_URL}/pluginfile.php/301/mod_resource/content/1/notes.txt`,
  slides: `${SITE_URL}${SLIDES_PATH}`,
  pixel: `${SITE_URL}${PIXEL_PATH}`,
} as const;

/** A one-page PDF with a text layer, written by hand. */
export function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  return strToU8(
    [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Root 1 0 R/Size 6>>',
      '%%EOF',
    ].join('\n'),
  );
}

export function tinyDocx(...paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  return zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });
}

export const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** A complete 1x1 PNG, for clients that decode the images they are given (the signature alone is not an image). */
export const PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);

/** A file the mock file server holds. */
export interface MockFile {
  /** Course the file belongs to; only its students may download it. */
  course: number;
  body: Uint8Array | string;
  type: string;
}

export const FILES: Record<string, MockFile> = {
  [NOTES_PATH]: {
    course: COURSE_ALG,
    body: 'Big-O notes: O(n log n) beats O(n^2).',
    type: 'text/plain; charset=utf-8',
  },
  [SLIDES_PATH]: { course: COURSE_ALG, body: tinyPdf('Lecture one slides'), type: 'application/pdf' },
  '/webservice/pluginfile.php/303/mod_resource/content/1/syllabus.docx': {
    course: COURSE_ALG,
    body: tinyDocx('Syllabus', 'Week 1: sorting'),
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '/webservice/pluginfile.php/317/mod_resource/content/1/schedule.docx': {
    course: COURSE_ALG,
    body: zipSync({
      'word/document.xml': strToU8(
        '<w:document><w:body>' +
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Schedule</w:t></w:r></w:p>' +
          '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Week</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Topic</w:t></w:r></w:p></w:tc></w:tr>' +
          '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Sorting</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '</w:body></w:document>',
      ),
    }),
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '/webservice/pluginfile.php/304/mod_resource/content/1/diagram.png': {
    course: COURSE_ALG,
    body: PNG_BYTES,
    type: 'image/png',
  },
  '/webservice/pluginfile.php/305/mod_resource/content/1/lecture.mp4': {
    course: COURSE_ALG,
    body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    type: 'video/mp4',
  },
  '/webservice/pluginfile.php/306/mod_resource/content/1/page.html': {
    course: COURSE_ALG,
    body: '<html><body><h1>Welcome</h1><p>Read <b>chapter 1</b>.</p><script>alert(1)</script></body></html>',
    type: 'text/html',
  },
  '/webservice/pluginfile.php/307/mod_resource/content/1/huge.bin': {
    course: COURSE_ALG,
    body: new Uint8Array(21 * 1024 * 1024),
    type: 'application/octet-stream',
  },
  '/webservice/pluginfile.php/310/mod_resource/content/1/materials.zip': {
    course: COURSE_ALG,
    body: zipSync({
      'code/Sort.kt': strToU8('fun sort() = Unit'),
      'readme.txt': strToU8('Lab materials'),
      'clip.mp4': new Uint8Array([0, 0, 0, 24]),
    }),
    type: 'application/zip',
  },
  '/webservice/pluginfile.php/311/mod_resource/content/1/Main.kt': {
    course: COURSE_ALG,
    body: 'fun main() = Unit',
    type: 'application/octet-stream',
  },
  [PIXEL_PATH]: { course: COURSE_ALG, body: PIXEL_PNG, type: 'image/png' },
  '/webservice/pluginfile.php/312/mod_resource/content/1/picture': {
    course: COURSE_ALG,
    body: PNG_BYTES,
    type: 'application/octet-stream',
  },
  '/webservice/pluginfile.php/314/mod_resource/content/1/legacy.txt': {
    course: COURSE_ALG,
    body: new Uint8Array([0x7a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6]),
    type: 'text/plain',
  },
  '/webservice/pluginfile.php/315/mod_resource/content/1/letter.odt': {
    course: COURSE_ALG,
    body: zipSync({
      mimetype: strToU8('application/vnd.oasis.opendocument.text'),
      'content.xml': strToU8(
        '<office:document-content xmlns:office="o" xmlns:text="t"><office:body><office:text><text:p>Dear students</text:p></office:text></office:body></office:document-content>',
      ),
    }),
    type: 'application/vnd.oasis.opendocument.text',
  },
  '/webservice/pluginfile.php/313/mod_resource/content/1/blob.dat': {
    course: COURSE_ALG,
    body: new Uint8Array([0, 1, 2, 3, 255, 254]),
    type: 'application/octet-stream',
  },
  '/webservice/pluginfile.php/308/mod_resource/content/1/long.txt': {
    course: COURSE_ALG,
    body: 'a'.repeat(2500) + 'b'.repeat(2500),
    type: 'text/plain',
  },
};

const fileEntry = (filename: string, path: string, size: number, mimetype: string) => ({
  type: 'file',
  filename,
  filepath: '/',
  filesize: size,
  fileurl: `${SITE_URL}${path}`,
  mimetype,
  timemodified: 1_760_000_000,
});

export const COURSES = [
  {
    id: COURSE_ALG,
    shortname: 'ALG',
    fullname: '{mlang en}Algorithms{mlang}{mlang pl}Algorytmy{mlang}',
    enrolledusercount: 120,
    visible: 1,
    startdate: 1_759_000_000,
    enddate: 1_780_000_000,
  },
  {
    id: COURSE_DB,
    shortname: 'DB',
    fullname: 'Databases',
    enrolledusercount: 90,
    visible: 1,
    startdate: 1_759_000_000,
    enddate: 1_780_000_000,
  },
] as const;

/** Per-course content, in the shape of the matching Moodle web service result. */
export interface CourseData {
  contents: unknown[];
  assignments: unknown[];
  quizzes: unknown[];
  forums: unknown[];
  pages: unknown[];
  resources: unknown[];
  urls: unknown[];
  labels: unknown[];
  wikis: unknown[];
  glossaries: unknown[];
  lessons: unknown[];
  choices: unknown[];
  feedbacks: unknown[];
  events: unknown[];
}

/** One tiny pasted picture, as the Moodle editor leaves it in a page. */
export const PASTED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A page that is long, styled the way the editor styles it, and holds a table and a pasted picture. */
export const BIG_PAGE_HTML =
  '<h2 style="color:#333;font-family:Arial">Sorting</h2>' +
  '<p style="margin:0">Read the <a href="https://moodle.example.edu/2025/pluginfile.php/301/mod_resource/content/1/notes.txt">notes</a>.</p>' +
  '<table><tr><th>Algorithm</th><th>Time</th></tr><tr><td>Quicksort</td><td>O(n log n)</td></tr></table>' +
  `<p><img alt="Diagram" src="${PASTED_PNG}"></p>` +
  `<p>${'Filler sentence. '.repeat(200)}</p>`;

export const COURSE_DATA: Record<number, CourseData> = {
  [COURSE_ALG]: {
    contents: [
      {
        id: 1,
        name: 'Week 1: Sorting',
        visible: 1,
        modules: [
          {
            id: IDS.cmidAssign,
            name: 'Homework 1',
            modname: 'assign',
            instance: IDS.assign,
            visible: 1,
          },
          {
            id: 2003,
            name: 'Lecture notes',
            modname: 'resource',
            instance: 20,
            contents: [fileEntry('notes.txt', NOTES_PATH, 37, 'text/plain')],
          },
          {
            id: IDS.cmidPage,
            name: 'Welcome page',
            modname: 'page',
            instance: 30,
          },
          {
            id: IDS.cmidBigPage,
            name: 'Big page',
            modname: 'page',
            instance: 31,
          },
        ],
      },
      { id: 2, name: 'Week 2: Searching', visible: 1, modules: [] },
    ],
    assignments: [
      {
        id: IDS.assign,
        cmid: IDS.cmidAssign,
        course: COURSE_ALG,
        name: 'Homework 1',
        duedate: 1_762_000_000,
        intro: '<p>Implement quicksort.</p>',
        introattachments: [fileEntry('notes.txt', NOTES_PATH, 37, 'text/plain')],
      },
    ],
    quizzes: [
      {
        id: IDS.quiz,
        course: COURSE_ALG,
        coursemodule: 2010,
        name: 'Sorting quiz',
        timeopen: 1_761_000_000,
        timeclose: 1_762_500_000,
        timelimit: 1800,
        attempts: 2,
        grade: 10,
      },
    ],
    forums: [
      {
        id: IDS.forum,
        course: COURSE_ALG,
        cmid: 2020,
        name: 'Announcements',
        type: 'news',
        numdiscussions: 1,
      },
    ],
    pages: [
      {
        id: 30,
        coursemodule: IDS.cmidPage,
        course: COURSE_ALG,
        name: 'Welcome page',
        content: '<p>Welcome to <b>Algorithms</b>.</p>',
        contentfiles: [
          fileEntry(
            'page.html',
            '/webservice/pluginfile.php/306/mod_resource/content/1/page.html',
            90,
            'text/html',
          ),
        ],
      },
      {
        id: 31,
        coursemodule: IDS.cmidBigPage,
        course: COURSE_ALG,
        name: 'Big page',
        content: BIG_PAGE_HTML,
        contentfiles: [],
      },
    ],
    resources: [
      {
        id: 20,
        coursemodule: 2003,
        course: COURSE_ALG,
        name: 'Lecture notes',
        contentfiles: [fileEntry('notes.txt', NOTES_PATH, 37, 'text/plain')],
      },
    ],
    urls: [
      {
        id: 40,
        coursemodule: 2004,
        course: COURSE_ALG,
        name: 'Visualgo',
        externalurl: 'https://visualgo.net/',
      },
    ],
    labels: [
      { id: 50, coursemodule: 2005, course: COURSE_ALG, name: 'Hello', intro: '<h3>Exam in January</h3>' },
    ],
    wikis: [
      { id: IDS.wiki, coursemodule: 2006, course: COURSE_ALG, name: 'Class wiki', firstpagetitle: 'Home' },
    ],
    glossaries: [{ id: IDS.glossary, coursemodule: 2007, course: COURSE_ALG, name: 'Terms' }],
    lessons: [{ id: IDS.lesson, coursemodule: 2008, course: COURSE_ALG, name: 'Intro lesson' }],
    choices: [{ id: IDS.choice, coursemodule: 2009, course: COURSE_ALG, name: 'Pick a topic' }],
    feedbacks: [{ id: IDS.feedback, coursemodule: 2012, course: COURSE_ALG, name: 'Course survey' }],
    events: [
      {
        id: 900,
        name: 'Homework 1 is due',
        modulename: 'assign',
        instance: IDS.assign,
        timestart: 1_762_000_000,
        course: { id: COURSE_ALG },
        action: { name: 'addsubmission', actionable: true },
      },
    ],
  },
  [COURSE_DB]: {
    contents: [{ id: 3, name: 'Intro to SQL', visible: 1, modules: [] }],
    assignments: [],
    quizzes: [],
    forums: [{ id: 8, course: COURSE_DB, cmid: 2030, name: 'Ogłoszenia', type: 'news', numdiscussions: 0 }],
    pages: [],
    resources: [],
    urls: [],
    labels: [],
    wikis: [],
    glossaries: [],
    lessons: [],
    choices: [],
    feedbacks: [],
    events: [],
  },
};

export const SUBMISSION = {
  lastattempt: {
    submission: { id: 70, userid: ALICE.id, status: 'submitted', timemodified: 1_761_500_000 },
    submissionsenabled: true,
  },
  feedback: { grade: { grade: '8.50000' }, gradefordisplay: '8.50 / 10', feedbackplagiarism: '' },
  warnings: [],
};

export const DISCUSSIONS = {
  discussions: [
    {
      id: 1200,
      discussion: IDS.discussion,
      name: 'Exam date',
      userfullname: 'Prof. Turing',
      created: 1_761_000_000,
      message: '<p>The exam is on 20 January.</p>',
    },
  ],
  warnings: [],
};

export const POSTS = {
  posts: [
    {
      id: 1201,
      discussionid: IDS.discussion,
      subject: 'Exam date',
      author: { fullname: 'Prof. Turing' },
      message: '<p>The exam is on 20 January.</p>',
      attachments: [fileEntry('notes.txt', NOTES_PATH, 37, 'text/plain')],
    },
    {
      id: 1202,
      discussionid: IDS.discussion,
      subject: 'Re: Exam date',
      author: {
        fullname: 'Alice Anderson',
        urls: { profileimage: 'https://moodle.example.edu/2025/pluginfile.php/5/user/icon/f1' },
        profileimageurl: 'https://moodle.example.edu/2025/pluginfile.php/5/user/icon/f1',
      },
      messageformat: 1,
      message: '<p>Thank you!</p>',
      attachments: [],
    },
  ],
  forumid: IDS.forum,
  courseid: COURSE_ALG,
};

export const WIKI_PAGES = {
  pages: [
    { id: 1, subwikiid: 1, title: 'Home', cachedcontent: '<p>Wiki home</p>', timemodified: 1_761_000_000 },
  ],
  warnings: [],
};

export const QUIZ_ATTEMPTS = {
  attempts: [
    {
      id: IDS.attempt,
      quiz: IDS.quiz,
      userid: ALICE.id,
      state: 'finished',
      sumgrades: 7,
      timefinish: 1_761_100_000,
    },
  ],
  warnings: [],
};

export const QUIZ_REVIEW = {
  grade: '7.00000',
  attempt: QUIZ_ATTEMPTS.attempts[0],
  questions: [
    {
      slot: 1,
      type: 'multichoice',
      status: 'Correct',
      mark: '1.00',
      html: '<div>Which sort is stable?</div>',
    },
  ],
  warnings: [],
};

export const NOTIFICATIONS = {
  notifications: [
    { id: 5000, subject: 'Your grade for Homework 1 is available', timecreated: 1_761_600_000, read: false },
  ],
  unreadcount: 1,
};

export const UPCOMING = {
  events: [
    {
      id: 900,
      name: 'Homework 1 is due',
      timestart: 1_762_000_000,
      course: { id: COURSE_ALG, shortname: 'ALG' },
    },
  ],
  daynames: [],
  defaulteventcontext: 1,
};

export const GRADE_ITEMS = {
  usergrades: [
    {
      courseid: COURSE_ALG,
      userid: ALICE.id,
      gradeitems: [{ id: 1, itemname: 'Homework 1', gradeformatted: '8.50', percentageformatted: '85 %' }],
    },
  ],
  warnings: [],
};

export const COURSE_GRADES = {
  grades: [
    { courseid: COURSE_ALG, grade: '8.50', rawgrade: '8.5' },
    { courseid: COURSE_DB, grade: '-', rawgrade: null },
  ],
  warnings: [],
};

export const COMPLETION = {
  statuses: [
    { cmid: IDS.cmidAssign, modname: 'assign', instance: IDS.assign, state: 1, timecompleted: 1_761_500_000 },
  ],
  warnings: [],
};

export const GLOSSARY_ENTRIES = {
  count: 1,
  entries: [{ id: 1, glossaryid: IDS.glossary, concept: 'Big-O', definition: '<p>Growth rate.</p>' }],
  warnings: [],
};

export const LESSON_PAGES = {
  pages: [{ page: { id: 1, lessonid: IDS.lesson, title: 'Start', contents: '<p>Begin here.</p>' } }],
  warnings: [],
};

export const CHOICE_RESULTS = {
  options: [{ id: 1, text: 'Sorting', userresponses: [], numberofuser: 3, percentageamount: 75 }],
  warnings: [],
};

export const FEEDBACK_ANALYSIS = {
  completedcount: 5,
  itemscount: 1,
  itemsdata: [{ item: { id: 1, name: 'How was it?' }, data: ['4.2'] }],
  warnings: [],
};

/** Someone who teaches the Algorithms course. */
export const TEACHER = { id: 50, fullname: 'Dr. Grace Turing', email: 'g.turing@example.edu' } as const;

const STUDENT_ROLE = { roleid: 5, name: 'Student', shortname: 'student', sortorder: 5 };
const TEACHER_ROLE = { roleid: 3, name: 'Teacher', shortname: 'editingteacher', sortorder: 3 };
const ASSISTANT_ROLE = { roleid: 4, name: 'Non-editing teacher', shortname: 'teacher', sortorder: 4 };

/** What `core_enrol_get_enrolled_users` returns, with the fields the tool must not pass on. */
export const ENROLLED_USERS: Record<number, unknown[]> = {
  [COURSE_ALG]: [
    {
      ...TEACHER,
      username: 'gturing',
      lastaccess: 1_761_000_000,
      profileimageurlsmall: 'https://moodle.example.edu/2025/pluginfile.php/5/user/icon/f2',
      roles: [TEACHER_ROLE],
    },
    {
      id: 51,
      fullname: 'Dr. Ada Assistant',
      email: 'a.assistant@example.edu',
      lastaccess: 1_761_000_100,
      roles: [ASSISTANT_ROLE],
    },
    { id: ALICE.id, fullname: ALICE.fullname, email: 'alice@example.edu', roles: [STUDENT_ROLE] },
    { id: BOB.id, fullname: BOB.fullname, email: 'bob@example.edu', roles: [STUDENT_ROLE] },
  ],
  [COURSE_DB]: [
    { id: ALICE.id, fullname: ALICE.fullname, email: 'alice@example.edu', roles: [STUDENT_ROLE] },
  ],
};

/** What `core_user_get_users_by_field` returns for a user the signed-in user may see. */
export const USER_PROFILES: Record<number, Record<string, unknown>> = {
  [TEACHER.id]: {
    ...TEACHER,
    username: 'gturing',
    phone1: '+48 123 456 789',
    department: 'Computer Science',
    institution: 'Example University',
    city: 'Kraków',
    country: 'PL',
    description: '<p>Office hours: Monday 10:00.</p>',
    lastaccess: 1_761_000_000,
    profileimageurl: 'https://moodle.example.edu/2025/pluginfile.php/5/user/icon/f1',
    preferences: [{ name: 'auth_forcepasswordchange', value: '0' }],
  },
};

export const CONVERSATION_IDS = { withTeacher: 70, groupChat: 71, notAMember: 72 } as const;

const MESSAGES = [
  {
    id: 903,
    useridfrom: TEACHER.id,
    text: '<p>Please send the draft by Friday.</p>',
    timecreated: 1_761_300_000,
  },
  {
    id: 902,
    useridfrom: ALICE.id,
    text: '<p>Hello, a question about homework 1.</p>',
    timecreated: 1_761_200_000,
  },
  { id: 901, useridfrom: TEACHER.id, text: '<p>Welcome to the course.</p>', timecreated: 1_761_100_000 },
];

/** Which conversations exist, who is in them, and how many messages the signed-in member has not read. */
export const CONVERSATIONS: Record<
  number,
  { name: string; type: number; unreadcount: number; members: number[]; messages: typeof MESSAGES }
> = {
  [CONVERSATION_IDS.withTeacher]: {
    name: TEACHER.fullname,
    type: 1,
    unreadcount: 2,
    members: [ALICE.id, TEACHER.id],
    messages: MESSAGES,
  },
  [CONVERSATION_IDS.groupChat]: {
    name: 'Study group',
    type: 2,
    unreadcount: 0,
    members: [ALICE.id, BOB.id, 60],
    messages: [{ id: 910, useridfrom: BOB.id, text: '<p>Library at 5?</p>', timecreated: 1_761_400_000 }],
  },
  [CONVERSATION_IDS.notAMember]: {
    name: 'Private',
    type: 1,
    unreadcount: 0,
    members: [BOB.id, 61],
    messages: [{ id: 920, useridfrom: 61, text: '<p>SECRET</p>', timecreated: 1_761_500_000 }],
  },
};

const NAMES: Record<number, string> = {
  [ALICE.id]: ALICE.fullname,
  [BOB.id]: BOB.fullname,
  [TEACHER.id]: TEACHER.fullname,
  60: 'Carol Clark',
  61: 'Dan Doe',
};

/** A conversation member the way Moodle lists one, with fields the tool must not pass on. */
export const memberOf = (id: number) => ({
  id,
  fullname: NAMES[id] ?? `User ${id}`,
  profileimageurl: `https://moodle.example.edu/2025/pluginfile.php/${id}/user/icon/f1`,
  isonline: true,
  isblocked: false,
});
