import { describe, expect, it } from 'vitest';

import {
  briefHtml,
  describeItem,
  describePage,
  pickAssignments,
  pickCompletion,
  pickCourses,
  pickEvents,
  pickForumDiscussions,
  pickForumPosts,
  pickForums,
  pickGrades,
  pickNotifications,
  pickQuizAttempts,
  pickQuizzes,
  pickSearchedCourses,
  pickSiteInfo,
  shortMarkdown,
  withBriefIntro,
} from './pick.ts';

describe('briefHtml', () => {
  it('is one line of Markdown, cut with an ellipsis', () => {
    expect(briefHtml('<h3>Exam</h3><p>in <b>January</b></p>')).toBe('### Exam in **January**');
    const long = briefHtml(`<p>${'word '.repeat(500)}</p>`, 100) as string;
    expect(long).toHaveLength(101);
    expect(long.endsWith('…')).toBe(true);
  });

  it('drops pasted pictures and scripts, and leaves anything but text alone', () => {
    expect(briefHtml('<p>a</p><script>x()</script><img src="data:image/png;base64,AAAA" alt="f">')).toBe(
      'a [image: f]',
    );
    expect(briefHtml(5)).toBe(5);
    expect(briefHtml(undefined)).toBeUndefined();
  });

  it('only touches an item that has an intro', () => {
    expect(withBriefIntro({ id: 1, intro: '<p>x</p>' })).toEqual({ id: 1, intro: 'x' });
    expect(withBriefIntro({ id: 1 })).toEqual({ id: 1 });
    expect(withBriefIntro('x')).toBe('x');
  });
});

describe('pickCourses', () => {
  const course = (id: number, extra: object = {}) => ({
    id,
    shortname: `C${id}`,
    fullname: `Course ${id}`,
    visible: 1,
    summary: '<p>long</p>',
    courseimage: 'https://x/c.svg',
    overviewfiles: [{ filename: 'a.png' }],
    showgrades: true,
    ...extra,
  });

  it('keeps what picks a course, with a short summary, and drops pictures and settings', () => {
    expect(pickCourses([course(1, { hidden: false, startdate: 5, progress: 50, lastaccess: 9 })])).toEqual([
      {
        id: 1,
        shortname: 'C1',
        fullname: 'Course 1',
        summary: 'long',
        visible: 1,
        hidden: false,
        startdate: 5,
        progress: 50,
        lastaccess: 9,
      },
    ]);
  });

  it('lists courses the user has not hidden first and keeps every course', () => {
    const result = pickCourses([
      course(1, { hidden: true }),
      course(2, { hidden: false }),
      course(3),
      course(4, { hidden: true }),
    ]);
    expect((result as { id: number }[]).map((c) => c.id)).toEqual([2, 3, 1, 4]);
  });

  it('passes anything of another shape through unchanged', () => {
    expect(pickCourses({ exception: 'x' })).toEqual({ exception: 'x' });
  });
});

describe('pickQuizzes', () => {
  it('keeps when, how long, how many tries and how graded, with the intro as Markdown', () => {
    const quiz = {
      id: 1,
      name: 'Q',
      timeclose: 5,
      timelimit: 60,
      attempts: 2,
      intro: '<p>Be <b>quick</b></p>',
      preferredbehaviour: 'x',
      browsersecurity: '-',
    };
    expect(pickQuizzes({ quizzes: [quiz], warnings: [] })).toEqual({
      quizzes: [{ id: 1, name: 'Q', timeclose: 5, timelimit: 60, attempts: 2, intro: 'Be **quick**' }],
      warnings: [],
    });
  });

  it('passes anything of another shape through unchanged', () => {
    expect(pickQuizzes({ exception: 'x' })).toEqual({ exception: 'x' });
    expect(pickQuizzes('text')).toBe('text');
  });
});

describe('pickEvents', () => {
  const event = {
    id: 9,
    name: 'Homework due',
    description: '<p>Hand in <b>by Friday</b></p>',
    eventtype: 'due',
    modulename: 'assign',
    instance: 7,
    timestart: 100,
    timeduration: 0,
    overdue: false,
    viewurl: 'https://x.test/v',
    editurl: 'https://x.test/e',
    deleteurl: 'https://x.test/d',
    formattedtime: '<a>Friday</a>',
    icon: { key: 'i', component: 'c' },
    course: { id: 3, fullname: 'Algorithms', shortname: 'ALG', summary: '<p>long</p>', startdate: 1 },
    action: {
      name: 'Add submission',
      url: 'https://x.test/a',
      itemcount: 1,
      actionable: true,
      showitemcount: false,
    },
  };

  it('keeps what, when and what to do, and drops edit links, icons and the whole course record', () => {
    expect(pickEvents({ events: [event], firstid: 9 })).toEqual({
      events: [
        {
          id: 9,
          name: 'Homework due',
          description: 'Hand in **by Friday**',
          eventtype: 'due',
          modulename: 'assign',
          instance: 7,
          timestart: 100,
          timeduration: 0,
          overdue: false,
          viewurl: 'https://x.test/v',
          course: { id: 3, fullname: 'Algorithms', shortname: 'ALG' },
          action: { name: 'Add submission', url: 'https://x.test/a', actionable: true },
        },
      ],
      firstid: 9,
    });
  });
});

describe('pickGrades', () => {
  it('keeps the grade, its range, weight and class average, and feedback as Markdown', () => {
    const item = {
      id: 1,
      itemname: 'Homework',
      cmid: 5,
      graderaw: 8.5,
      gradeformatted: '8.50',
      percentageformatted: '85 %',
      averageformatted: '7.10',
      feedback: '<p>Well <i>done</i></p>',
      feedbackformat: 1,
      gradeneedsupdate: false,
      outputorigin: 'x',
      lowrange: 1,
    };
    expect(
      pickGrades({ usergrades: [{ courseid: 3, userid: 9, gradeitems: [item] }], warnings: [] }),
    ).toEqual({
      usergrades: [
        {
          courseid: 3,
          userid: 9,
          gradeitems: [
            {
              id: 1,
              itemname: 'Homework',
              cmid: 5,
              graderaw: 8.5,
              gradeformatted: '8.50',
              percentageformatted: '85 %',
              averageformatted: '7.10',
              feedback: 'Well *done*',
            },
          ],
        },
      ],
      warnings: [],
    });
  });
});

describe('pickCompletion', () => {
  it('keeps the state and turns the rules behind it into short lines', () => {
    const status = {
      cmid: 5,
      modname: 'assign',
      instance: 7,
      state: 1,
      timecompleted: 100,
      tracking: 2,
      valueused: false,
      hascompletion: true,
      isautomatic: true,
      istrackeduser: true,
      uservisible: true,
      details: [
        { rulename: 'completionview', rulevalue: { status: 1, description: 'Done: View' } },
        { rulename: 'completionusegrade', rulevalue: { status: 0, description: '' } },
      ],
    };
    expect(pickCompletion({ statuses: [status], warnings: [] })).toEqual({
      statuses: [
        {
          cmid: 5,
          modname: 'assign',
          instance: 7,
          state: 1,
          timecompleted: 100,
          tracking: 2,
          rules: ['completionview: Done: View', 'completionusegrade'],
        },
      ],
      warnings: [],
    });
  });

  it('copes with a status that has no rules', () => {
    expect(pickCompletion({ statuses: [{ cmid: 1, state: 0 }] })).toEqual({
      statuses: [{ cmid: 1, state: 0 }],
    });
  });
});

describe('shortMarkdown', () => {
  it('is briefHtml for a string you know is one', () => {
    expect(shortMarkdown('<p>a <b>b</b></p>')).toBe('a **b**');
    expect(shortMarkdown('<p>abcdef</p>', 3)).toBe('abc…');
    expect(shortMarkdown('')).toBe('');
  });
});

describe('describePage', () => {
  it('reports the size of a page and its files instead of showing them', () => {
    const page = {
      id: 1,
      coursemodule: 8,
      name: 'P',
      intro: '<p>About <b>this</b></p>',
      content: '<p>abc</p>',
      contentfiles: [{ fileurl: 'a' }, { fileurl: 'b' }],
      displayoptions: 'a:1:{}',
    };
    expect(describePage(page)).toEqual({
      id: 1,
      coursemodule: 8,
      name: 'P',
      intro: 'About **this**',
      content_chars: 10,
      content_files: 2,
    });
  });

  it('copes with a page without content and with something that is not a page', () => {
    expect(describePage({ id: 1 })).toEqual({ id: 1, content_chars: 0, content_files: 0 });
    expect(describePage('x')).toBe('x');
  });
});

describe('describeItem', () => {
  it('counts the intro pictures and shortens the intro, keeping the other fields', () => {
    expect(describeItem({ id: 1, intro: '<h3>Exam</h3>', introfiles: [{}, {}], visible: 1 })).toEqual({
      id: 1,
      intro: '### Exam',
      intro_files: 2,
      visible: 1,
    });
  });

  it('adds no count when there is no list of pictures, and cuts a long intro at 1,500 characters', () => {
    expect(describeItem({ id: 1 })).toEqual({ id: 1 });
    const long = describeItem({ intro: `<p>${'word '.repeat(600)}</p>` }) as { intro: string };
    expect(long.intro).toHaveLength(1501);
  });
});

describe('pickSiteInfo', () => {
  it('keeps the identity fields and drops the private key and function list', () => {
    const out = pickSiteInfo({
      sitename: 'S',
      userid: 3,
      userprivateaccesskey: 'secret',
      functions: [{ name: 'f' }],
    });
    expect(out).toEqual({ sitename: 'S', userid: 3 });
  });

  it('passes anything that is not a record through unchanged', () => {
    expect(pickSiteInfo(null)).toBeNull();
    expect(pickSiteInfo('text')).toBe('text');
    expect(pickSiteInfo([1])).toEqual([1]);
  });
});

describe('pickAssignments', () => {
  it('drops settings and keeps ids, dates, the intro as Markdown and the task files', () => {
    const result = pickAssignments({
      courses: [
        {
          id: 1,
          assignments: [
            {
              id: 5,
              cmid: 6,
              name: 'Lab',
              intro: '<p>Do <b>it</b></p>',
              duedate: 9,
              blindmarking: 0,
              configs: [{ plugin: 'file' }],
              introattachments: [{ filename: 'a.pdf', fileurl: 'https://x/a.pdf' }],
            },
          ],
        },
      ],
    });
    expect(result).toEqual({
      courses: [
        {
          id: 1,
          assignments: [
            {
              id: 5,
              cmid: 6,
              name: 'Lab',
              intro: 'Do **it**',
              duedate: 9,
              introattachments: [{ filename: 'a.pdf', fileurl: 'https://x/a.pdf' }],
            },
          ],
        },
      ],
    });
  });
});

describe('pickForums', () => {
  it('drops forum settings and keeps the ids and what the forum is', () => {
    expect(
      pickForums([{ id: 1, cmid: 2, name: 'News', type: 'news', numdiscussions: 3, rsstype: 0, scale: 0 }]),
    ).toEqual([{ id: 1, cmid: 2, name: 'News', type: 'news', numdiscussions: 3 }]);
  });
});

describe('pickNotifications', () => {
  it('keeps the message once, with the ids to follow it', () => {
    const result = pickNotifications({
      unreadcount: 1,
      notifications: [
        {
          id: 1,
          subject: 'S',
          text: '<p>S</p>',
          fullmessage: 'Body',
          fullmessagehtml: '<div>Body</div>',
          contexturl: 'https://x/d',
          customdata: '{"discussionid":"7"}',
          timecreated: 5,
          timecreatedpretty: '1 day ago',
          iconurl: 'https://x/i.png',
          useridto: 9,
        },
      ],
    });
    expect(result).toEqual({
      unreadcount: 1,
      notifications: [
        {
          id: 1,
          subject: 'S',
          fullmessage: 'Body',
          contexturl: 'https://x/d',
          customdata: '{"discussionid":"7"}',
          timecreated: 5,
        },
      ],
    });
  });
});

describe('forum, search and quiz attempt shapes', () => {
  it('drops the permission flags and links of forum posts at any depth, and keeps the text and files', () => {
    expect(
      pickForumPosts({
        posts: [
          {
            id: 1,
            message: '<p>Hi</p>',
            capabilities: { reply: true },
            urls: { view: 'https://x/p' },
            author: { fullname: 'A', urls: { profileimage: 'https://x/i' } },
            attachments: [{ filename: 'a.txt', fileurl: 'https://x/a.txt' }],
          },
        ],
      }),
    ).toEqual({
      posts: [
        {
          id: 1,
          message: '<p>Hi</p>',
          author: { fullname: 'A' },
          attachments: [{ filename: 'a.txt', fileurl: 'https://x/a.txt' }],
        },
      ],
    });
  });

  it('shows a preview of each discussion message and keeps the ids', () => {
    expect(
      pickForumDiscussions({
        discussions: [{ id: 1, discussion: 7, message: '<p>Hi <b>all</b></p>', mailed: 0 }],
      }),
    ).toEqual({
      discussions: [{ id: 1, discussion: 7, message: 'Hi **all**' }],
    });
  });

  it('keeps found courses with their teachers and a short summary, without pictures', () => {
    expect(
      pickSearchedCourses({
        total: 1,
        courses: [
          {
            id: 2,
            fullname: 'F',
            summary: '<p>S</p>',
            courseimage: 'https://x/c.png',
            contacts: [{ id: 3 }],
          },
        ],
      }),
    ).toEqual({ total: 1, courses: [{ id: 2, fullname: 'F', summary: 'S', contacts: [{ id: 3 }] }] });
  });

  it('keeps the state, score and times of a quiz attempt', () => {
    expect(
      pickQuizAttempts({
        attempts: [{ id: 4, state: 'finished', sumgrades: 7, layout: '1,0', uniqueid: 9 }],
      }),
    ).toEqual({
      attempts: [{ id: 4, state: 'finished', sumgrades: 7 }],
    });
  });
});
