import { describe, expect, it } from 'vitest';

import {
  briefHtml,
  describeItem,
  describePage,
  pickCompletion,
  pickEvents,
  pickGrades,
  pickQuizzes,
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
