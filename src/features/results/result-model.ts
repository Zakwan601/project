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
  student: Pick<Student, 'fourth_subject_id' | 'optional_subject_2_id' | 'group_elective_option_id' | 'group_fourth_option_id'>,
  courseOptions: SubjectCourseOption[],
) {
  if (!examSubject.subjects.is_fourth_subject) return true

  const optionById = new Map(courseOptions.map(option => [option.id, option]))
  const selectedSubjectIds = new Set<string>()
  for (const optionId of [student.group_elective_option_id, student.group_fourth_option_id]) {
    if (!optionId) continue
    const option = optionById.get(optionId)
    if (!option) continue
    selectedSubjectIds.add(option.first_paper_subject_id)
    selectedSubjectIds.add(option.second_paper_subject_id)
  }
  if (student.fourth_subject_id) selectedSubjectIds.add(student.fourth_subject_id)
  if (student.optional_subject_2_id) selectedSubjectIds.add(student.optional_subject_2_id)

  return selectedSubjectIds.has(examSubject.subject_id)
}
