import type { ClassGroup, ResultExam, Student, SubjectCourseOption } from '@/types/database'

export interface ExamWithDetails extends ResultExam {
  result_exam_types: { name: string; marks_mode?: 'sectioned' | 'total_only' | 'total_pass' }
  academic_years: { name: string; start_date?: string; end_date?: string }
  classes: { name: string; grade: string; section: string; class_group: ClassGroup }
}

export interface ExamSubject {
  id: string
  exam_id: string
  subject_id: string
  paper_group_id: string | null
  creative_max: number
  written_max: number
  practical_max: number
  pass_mark: number
  creative_pass_mark: number
  written_pass_mark: number
  practical_pass_mark: number
  sort_order: number
  subjects: { id: string; name: string; code: string; is_fourth_subject: boolean }
  result_subject_paper_groups: { name: string; code: string } | null
}

export interface MarkRow {
  id: string
  exam_subject_id: string
  student_id: string
  creative_marks: number | null
  written_marks: number | null
  practical_marks: number | null
  is_absent: boolean
  remarks: string | null
}

export interface ExamResultSubjectCell {
  obtained: number
  creativeMarks: number
  writtenMarks: number
  practicalMarks: number
  totalMax: number
  absent: boolean
  complete: boolean
  passed: boolean
  gradePoint: number
}

export interface ExamResultReportRow {
  id: string
  name: string
  admission: string
  roll: number | null
  subjects: Record<string, ExamResultSubjectCell>
  totalObtained: number
  totalMax: number
  failedSubjects: number
  gpa: number | null
  grade: string
  complete: boolean
  position: number | null
}

export interface MarkDraft {
  creative: string
  written: string
  practical: string
  absent: boolean
}

export interface ClassSubject {
  id: string
  name: string
  code: string
  is_active: boolean
  class_group: ClassGroup
  is_fourth_subject: boolean
}

export interface ResultSubjectPaperGroup {
  id: string
  class_group: ClassGroup
  name: string
  code: string
  first_paper_subject_id: string
  second_paper_subject_id: string
  is_active: boolean
}

export type ExamSubjectRole = 'main' | 'fourth'

export interface ConfigurableExamSubject extends ClassSubject {
  paper_group_id: string | null
}

export function buildExamSubjectCatalogue(
  subjects: ClassSubject[],
  paperGroups: ResultSubjectPaperGroup[],
  combinePapers: boolean,
): ConfigurableExamSubject[] {
  if (!combinePapers) return subjects.map(subject => ({ ...subject, paper_group_id: null }))

  const byId = new Map(subjects.map(subject => [subject.id, subject]))
  const pairedIds = new Set<string>()
  const combined = paperGroups.flatMap(group => {
    const first = byId.get(group.first_paper_subject_id)
    const second = byId.get(group.second_paper_subject_id)
    if (first?.class_group === group.class_group) pairedIds.add(first.id)
    if (second?.class_group === group.class_group) pairedIds.add(second.id)
    if (!group.is_active || !first || !second || first.class_group !== group.class_group || second.class_group !== group.class_group) return []
    return [{
      ...first, name: group.name, code: group.code,
      is_fourth_subject: first.is_fourth_subject || second.is_fourth_subject,
      paper_group_id: group.id,
    }]
  })
  // Keep genuine single-paper courses (such as ICT), never orphaned individual papers.
  const unpaired = subjects.filter(subject => !pairedIds.has(subject.id)
    && !/\b(?:1st|first|2nd|second)\s+paper\b/i.test(subject.name))
    .map(subject => ({ ...subject, paper_group_id: null }))
  return [...unpaired, ...combined].sort((a, b) => a.name.localeCompare(b.name))
}

export interface ExamSubjectConfigDraft {
  selected: boolean
  creative: string
  written: string
  practical: string
  pass: string
  creativePass: string
  writtenPass: string
  practicalPass: string
  total: string
}

export interface ResultSmsSummary {
  submitted: number
  skipped: number
  failed: number
  missingPhone: number
}

export interface ResultShareLink {
  id: string
  token: string
  expires_at: string | null
}

export function gradeSubject(obtained: number, totalMax: number, passMark: number, absent: boolean, sectionsPassed = true) {
  if (absent || !sectionsPassed || obtained < passMark) return { passed: false, gradePoint: 0 }
  const percentage = totalMax > 0 ? obtained * 100 / totalMax : 0
  if (percentage >= 80) return { passed: true, gradePoint: 5 }
  if (percentage >= 70) return { passed: true, gradePoint: 4 }
  if (percentage >= 60) return { passed: true, gradePoint: 3.5 }
  if (percentage >= 50) return { passed: true, gradePoint: 3 }
  if (percentage >= 40) return { passed: true, gradePoint: 2 }
  if (percentage >= 33) return { passed: true, gradePoint: 1 }
  return { passed: false, gradePoint: 0 }
}

export function overallGrade(gpa: number, failedSubjects: number) {
  if (failedSubjects > 0 || gpa < 1) return 'F'
  if (gpa >= 5) return 'A+'
  if (gpa >= 4) return 'A'
  if (gpa >= 3.5) return 'A-'
  if (gpa >= 3) return 'B'
  if (gpa >= 2) return 'C'
  return 'D'
}

export function examSubjectTotal(subject: ExamSubject) {
  return subject.creative_max + subject.written_max + subject.practical_max
}

export function examSubjectShortName(subject: ExamSubject) {
  const name = subject.result_subject_paper_groups?.name ?? subject.subjects.name
  const labels: [RegExp, string][] = [
    [/^bangla\b/i, 'Ban'], [/^english\b/i, 'Eng'], [/^(ict\b|information.*communication)/i, 'ICT'],
    [/^physics\b/i, 'Phy'], [/^chemistry\b/i, 'Chem'], [/^biology\b/i, 'Bio'], [/^higher\s+math/i, 'H.Math'],
    [/^accounting\b/i, 'Acc'], [/^finance\b/i, 'Fin'], [/^business\s+organi[sz]ation/i, 'BOM'],
    [/^production\s+management/i, 'PMM'], [/^civics\b/i, 'Civics'], [/^economics\b/i, 'Econ'],
    [/^islamic\s+history/i, 'I.Hist'], [/^social\s+work/i, 'S.Work'], [/^islamic\s+studies/i, 'I.Stud'],
    [/^home\s+science/i, 'H.Sci'], [/^logic\b/i, 'Logic'],
  ]
  const short = labels.find(([pattern]) => pattern.test(name))?.[1]
  if (!short) return name.replace(/\s*\([^)]*[\u0980-\u09ff][^)]*\)\s*$/u, '').trim()
  const paper = subject.paper_group_id ? null : name.match(/\b(1st|first|2nd|second)\s+paper\b/i)
  return paper ? `${short} ${/^(1st|first)$/i.test(paper[1]) ? '1' : '2'}` : short
}

export interface ExamResultColumn {
  field: 'written_marks' | 'creative_marks' | 'practical_marks'
  label: string
  maximum: number
}

export function examResultColumns(subject: ExamSubject, totalOnly: boolean): ExamResultColumn[] {
  if (totalOnly) return [{ field: 'written_marks', label: 'Marks', maximum: subject.written_max }]
  const columns: ExamResultColumn[] = [
    { field: 'written_marks', label: 'MCQ', maximum: subject.written_max },
    { field: 'creative_marks', label: 'CQ', maximum: subject.creative_max },
    // Preserve practical marks for regular exams that include that component.
    ...(subject.practical_max > 0 ? [{ field: 'practical_marks' as const, label: 'Prac', maximum: subject.practical_max }] : []),
  ]
  return columns.filter(column => column.maximum !== 0)
}

export function examResultComponentText(row: ExamResultReportRow, subject: ExamSubject, column: ExamResultColumn, mark?: MarkRow) {
  if (!row.subjects[subject.id]) return '—'
  if (row.subjects[subject.id].absent) return 'Absent'
  if (column.maximum <= 0 || mark?.[column.field] == null) return '—'
  return String(mark[column.field])
}

export function orderResultSubjects(subjects: ExamSubject[]) {
  const priority = (subject: ExamSubject) => {
    const code = (subject.result_subject_paper_groups?.code ?? subject.subjects.code).split('+')[0].trim()
    const name = subject.result_subject_paper_groups?.name ?? subject.subjects.name
    if (['101', '102'].includes(code) || /^bangla\b/i.test(name)) return 0
    if (['107', '108'].includes(code) || /^english\b/i.test(name)) return 1
    if (code === '275' || /^(ict\b|information.*communication)/i.test(name)) return 2
    return 3
  }
  // Keep the configured order for all remaining subjects without mutating query data.
  return [...subjects].sort((a, b) => priority(a) - priority(b))
}

export function isTotalOnlyExam(exam: ExamWithDetails | undefined) {
  return exam?.result_exam_types.marks_mode === 'total_only'
}

export function isTotalPassExam(exam: ExamWithDetails | undefined) {
  return exam?.result_exam_types.marks_mode === 'total_pass'
}

export function examSubjectConfigValues(row: ExamSubjectConfigDraft, totalOnly: boolean, totalPass = false) {
  return totalOnly ? [0, Number(row.total), 0, 0, Number(row.total), 0, 0, 0]
    : totalPass ? [Number(row.creative), Number(row.written), 0, Number(row.pass), Number(row.total), 0, 0, 0]
    : [row.creative, row.written, row.practical, row.pass, row.total, row.creativePass, row.writtenPass, row.practicalPass].map(Number)
}

export function validExamSubjectConfig(values: number[], totalOnly: boolean, totalPass = false) {
  return values.every(value => Number.isFinite(value) && value >= 0)
    && values[4] > 0 && Math.abs(values[0] + values[1] + values[2] - values[4]) <= 0.009
    && (totalOnly || (values[3] > 0 && values[3] <= values[4]
      && (totalPass ? values[0] + values[1] > 0 && values[2] === 0 && values.slice(5).every(value => value === 0)
        : [0, 1, 2].every(index => values[index] > 0
        ? values[index + 5] > 0 && values[index + 5] <= values[index]
        : values[index + 5] === 0))))
}

export function examSubjectAppliesToStudent(
  examSubject: ExamSubject,
  student: Pick<Student, 'class_group' | 'fourth_subject_id' | 'optional_subject_2_id' | 'group_elective_option_id' | 'group_fourth_option_id' | 'humanities_main_option_1_id' | 'humanities_main_option_2_id' | 'humanities_main_option_3_id' | 'humanities_fourth_option_id'>,
  courseOptions: SubjectCourseOption[],
  paperGroups: ResultSubjectPaperGroup[],
) {
  return examSubjectRoleForStudent(examSubject, student, courseOptions, paperGroups) !== null
}

export function subjectSectionsPassed(
  subject: Pick<ExamSubject, 'creative_max' | 'written_max' | 'practical_max' | 'creative_pass_mark' | 'written_pass_mark' | 'practical_pass_mark'>,
  marks: { creativeMarks: number; writtenMarks: number; practicalMarks: number },
) {
  return (subject.creative_max <= 0 || marks.creativeMarks >= subject.creative_pass_mark)
    && (subject.written_max <= 0 || marks.writtenMarks >= subject.written_pass_mark)
    && (subject.practical_max <= 0 || marks.practicalMarks >= subject.practical_pass_mark)
}

export function examSubjectRoleForStudent(
  examSubject: ExamSubject,
  student: Pick<Student, 'class_group' | 'fourth_subject_id' | 'optional_subject_2_id' | 'group_elective_option_id' | 'group_fourth_option_id' | 'humanities_main_option_1_id' | 'humanities_main_option_2_id' | 'humanities_main_option_3_id' | 'humanities_fourth_option_id'>,
  courseOptions: SubjectCourseOption[],
  paperGroups: ResultSubjectPaperGroup[],
): ExamSubjectRole | null {
  if (!examSubject.subjects.is_fourth_subject) return 'main'

  const optionById = new Map(courseOptions.map(option => [option.id, option]))
  const elective = student.group_elective_option_id
    ? optionById.get(student.group_elective_option_id)
    : undefined
  const fourthOptionId = student.group_fourth_option_id ?? student.humanities_fourth_option_id
  const fourth = fourthOptionId
    ? optionById.get(fourthOptionId)
    : undefined
  const electives = [elective, ...[student.humanities_main_option_1_id, student.humanities_main_option_2_id, student.humanities_main_option_3_id]
    .map(id => id ? optionById.get(id) : undefined)]
  const electiveIds = new Set(electives.flatMap(option => [option?.first_paper_subject_id, option?.second_paper_subject_id]).filter(Boolean))
  const fourthIds = new Set([
    fourth?.first_paper_subject_id,
    fourth?.second_paper_subject_id,
    student.fourth_subject_id,
    student.optional_subject_2_id,
  ].filter(Boolean))
  const paperGroup = examSubject.paper_group_id
    ? paperGroups.find(group => group.id === examSubject.paper_group_id)
    : undefined
  const representedSubjectIds = [
    examSubject.subject_id,
    paperGroup?.first_paper_subject_id,
    paperGroup?.second_paper_subject_id,
  ].filter(Boolean)

  if (representedSubjectIds.some(subjectId => fourthIds.has(subjectId))) return 'fourth'
  // Science students take both Biology and Higher Mathematics. Their profile
  // choice determines which course is fourth; the other remains a main course.
  if (student.class_group === 'science') return 'main'
  if (representedSubjectIds.some(subjectId => electiveIds.has(subjectId))) return 'main'
  return null
}

export function examSubjectCourseKey(examSubject: ExamSubject, paperGroups: ResultSubjectPaperGroup[]) {
  if (examSubject.paper_group_id) return examSubject.paper_group_id
  const group = paperGroups.find(item =>
    item.first_paper_subject_id === examSubject.subject_id
    || item.second_paper_subject_id === examSubject.subject_id,
  )
  return group?.id ?? examSubject.subject_id
}

export function calculateOfficialGpa(
  examSubjects: ExamSubject[],
  subjectResults: Record<string, ExamResultSubjectCell>,
  student: Pick<Student, 'class_group' | 'fourth_subject_id' | 'optional_subject_2_id' | 'group_elective_option_id' | 'group_fourth_option_id' | 'humanities_main_option_1_id' | 'humanities_main_option_2_id' | 'humanities_main_option_3_id' | 'humanities_fourth_option_id'>,
  courseOptions: SubjectCourseOption[],
  paperGroups: ResultSubjectPaperGroup[],
  countFourthSubject: boolean,
) {
  const courses = new Map<string, {
    role: ExamSubjectRole
    obtained: number
    totalMax: number
    passMark: number
    absent: boolean
    complete: boolean
    creative_max: number
    written_max: number
    practical_max: number
    creative_pass_mark: number
    written_pass_mark: number
    practical_pass_mark: number
    creativeMarks: number
    writtenMarks: number
    practicalMarks: number
  }>()

  for (const subject of examSubjects) {
    const role = examSubjectRoleForStudent(subject, student, courseOptions, paperGroups)
    const result = subjectResults[subject.id]
    if (!role || !result) continue
    const key = examSubjectCourseKey(subject, paperGroups)
    const course = courses.get(key) ?? {
      role, obtained: 0, totalMax: 0, passMark: 0, absent: false, complete: true,
      creative_max: 0, written_max: 0, practical_max: 0,
      creative_pass_mark: 0, written_pass_mark: 0, practical_pass_mark: 0,
      creativeMarks: 0, writtenMarks: 0, practicalMarks: 0,
    }
    course.obtained += result.obtained
    course.totalMax += result.totalMax
    course.passMark += subject.pass_mark
    course.creative_max += subject.creative_max
    course.written_max += subject.written_max
    course.practical_max += subject.practical_max
    course.creative_pass_mark += subject.creative_pass_mark
    course.written_pass_mark += subject.written_pass_mark
    course.practical_pass_mark += subject.practical_pass_mark
    course.creativeMarks += result.creativeMarks
    course.writtenMarks += result.writtenMarks
    course.practicalMarks += result.practicalMarks
    course.absent ||= result.absent
    course.complete &&= result.complete
    courses.set(key, course)
  }

  const graded = [...courses.values()].map(course => ({
    ...course,
    grade: gradeSubject(course.obtained, course.totalMax, course.passMark, course.absent, subjectSectionsPassed(course, course)),
  }))
  const main = graded.filter(course => course.role === 'main')
  const fourth = graded.filter(course => course.role === 'fourth')
  const failedMainSubjects = main.filter(course => course.complete && !course.grade.passed).length
  const mainGradePointTotal = main.reduce((sum, course) => sum + course.grade.gradePoint, 0)
  const fourthGradePoint = fourth.reduce((highest, course) => Math.max(highest, course.grade.gradePoint), 0)
  const fourthBonus = countFourthSubject ? Math.max(fourthGradePoint - 2, 0) : 0
  const gpa = failedMainSubjects > 0
    ? 0
    : Math.min(5, Number(((mainGradePointTotal + fourthBonus) / 6).toFixed(2)))

  return { gpa, failedMainSubjects, mainSubjectCount: main.length, fourthBonus }
}
