import type { ClassGroup, ResultExam, Student, SubjectCourseOption } from '@/types/database'

export interface ExamWithDetails extends ResultExam {
  result_exam_types: { name: string }
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

export interface ExamSubjectConfigDraft {
  selected: boolean
  creative: string
  written: string
  practical: string
  pass: string
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

export function gradeSubject(obtained: number, totalMax: number, passMark: number, absent: boolean) {
  if (absent || obtained < passMark) return { passed: false, gradePoint: 0 }
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

export function examSubjectAppliesToStudent(
  examSubject: ExamSubject,
  student: Pick<Student, 'class_group' | 'fourth_subject_id' | 'optional_subject_2_id' | 'group_elective_option_id' | 'group_fourth_option_id' | 'humanities_main_option_1_id' | 'humanities_main_option_2_id' | 'humanities_main_option_3_id' | 'humanities_fourth_option_id'>,
  courseOptions: SubjectCourseOption[],
  paperGroups: ResultSubjectPaperGroup[],
) {
  return examSubjectRoleForStudent(examSubject, student, courseOptions, paperGroups) !== null
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
  }>()

  for (const subject of examSubjects) {
    const role = examSubjectRoleForStudent(subject, student, courseOptions, paperGroups)
    const result = subjectResults[subject.id]
    if (!role || !result) continue
    const key = examSubjectCourseKey(subject, paperGroups)
    const course = courses.get(key) ?? {
      role, obtained: 0, totalMax: 0, passMark: 0, absent: false, complete: true,
    }
    course.obtained += result.obtained
    course.totalMax += result.totalMax
    course.passMark += subject.pass_mark
    course.absent ||= result.absent
    course.complete &&= result.complete
    courses.set(key, course)
  }

  const graded = [...courses.values()].map(course => ({
    ...course,
    grade: gradeSubject(course.obtained, course.totalMax, course.passMark, course.absent),
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
