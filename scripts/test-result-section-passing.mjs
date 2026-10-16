import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Exercise the actual shared frontend grading code without a browser.
const source = readFileSync(new URL('../src/features/results/result-model.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { gradeSubject, subjectSectionsPassed, calculateOfficialGpa } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)

const subject = {
  id: 'cq-mcq', subject_id: 'math', paper_group_id: null,
  creative_max: 70, written_max: 30, practical_max: 0,
  creative_pass_mark: 23, written_pass_mark: 10, practical_pass_mark: 0,
  pass_mark: 33, subjects: { is_fourth_subject: false },
}
const marks = (cq, mcq, practical = 0) => ({ creativeMarks: cq, writtenMarks: mcq, practicalMarks: practical })
const grade = (config, sections, absent = false) => gradeSubject(
  sections.creativeMarks + sections.writtenMarks + sections.practicalMarks,
  config.creative_max + config.written_max + config.practical_max,
  config.pass_mark, absent, subjectSectionsPassed(config, sections),
)

assert.equal(grade(subject, marks(70, 9)).passed, false, 'High total cannot compensate for failed MCQ')
assert.equal(grade(subject, marks(22, 30)).passed, false, 'High total cannot compensate for failed CQ')
assert.equal(grade(subject, marks(23, 10)).passed, true, 'Exact section and total thresholds pass')
assert.equal(grade({ ...subject, pass_mark: 40 }, marks(23, 10)).passed, false, 'Total threshold still applies')
assert.equal(grade(subject, marks(70, 30), true).passed, false, 'Absent subjects fail')
assert.equal(grade(subject, marks(56, 24)).gradePoint, 5, '80 percent with passing sections earns A+')
assert.equal(grade({ ...subject, practical_max: 25, practical_pass_mark: 8 }, marks(70, 30, 7)).passed, false, 'Practical passing is independent')
assert.equal(grade({ ...subject, written_max: 0, written_pass_mark: 0 }, marks(56, 0)).passed, true, 'Inactive sections do not fail')
assert.equal(grade({ ...subject, creative_pass_mark: 0, written_pass_mark: 0 }, marks(50, 0)).passed, true, 'Legacy configurations retain total-only passing')

const student = { class_group: 'science' }
const result = (config, cq, mcq) => ({
  ...marks(cq, mcq), obtained: cq + mcq,
  totalMax: config.creative_max + config.written_max,
  absent: false, complete: true, ...grade(config, marks(cq, mcq)),
})
const gpa = (subjects, results, options = [], groups = [], pupil = student) => calculateOfficialGpa(
  subjects, results, pupil, options, groups, true,
)
assert.equal(gpa([subject], { [subject.id]: result(subject, 70, 9) }).failedMainSubjects, 1, 'Section failure must propagate to main-course GPA')
assert.equal(gpa([subject], { [subject.id]: result(subject, 70, 9) }).gpa, 0, 'Failed main section forces zero GPA')

const paper2 = { ...subject, id: 'second', subject_id: 'math-second' }
const groups = [{ id: 'math-course', first_paper_subject_id: 'math', second_paper_subject_id: 'math-second' }]
assert.equal(gpa([subject, paper2], {
  [subject.id]: result(subject, 60, 9), [paper2.id]: result(paper2, 60, 11),
}, [], groups).failedMainSubjects, 0, 'Separate papers combine corresponding sections for course GPA')
assert.equal(gpa([subject, paper2], {
  [subject.id]: result(subject, 70, 9), [paper2.id]: result(paper2, 70, 9),
}, [], groups).failedMainSubjects, 1, 'Combined course fails when combined MCQ is below combined threshold')

const optional = { ...subject, subjects: { is_fourth_subject: true } }
const failedFourth = gpa([optional], { [subject.id]: result(subject, 70, 9) }, [], [], {
  ...student, fourth_subject_id: 'math',
})
assert.equal(failedFourth.failedMainSubjects, 0, 'Fourth-subject failure does not fail a main course')
assert.equal(failedFourth.fourthBonus, 0, 'A failed fourth-subject section earns no bonus')
console.log('Passed section thresholds, total thresholds, absent, practical, legacy, combined-paper GPA, and fourth-subject regressions.')
