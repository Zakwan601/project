import type { ClassGroup, Student, SubjectCourseOption } from '@/types/database'

export const HUMANITIES_ELECTIVE_FIELDS = [
  'humanities_main_option_1_id',
  'humanities_main_option_2_id',
  'humanities_main_option_3_id',
] as const

export type SubjectChoiceField = typeof HUMANITIES_ELECTIVE_FIELDS[number]
  | 'group_elective_option_id' | 'group_fourth_option_id'

export type StudentSubjectChoices = Pick<Student, 'class_group'>
  & Partial<Record<SubjectChoiceField, string | null>>

export function getStudentSubjectFields(group: ClassGroup): SubjectChoiceField[] {
  return [
    ...(group === 'humanities' ? HUMANITIES_ELECTIVE_FIELDS : group === 'business' ? ['group_elective_option_id' as const] : []),
    'group_fourth_option_id',
  ]
}

export function getStudentSubjectErrors(
  choices: StudentSubjectChoices,
  options?: SubjectCourseOption[],
  required = true,
) {
  const errors: Partial<Record<SubjectChoiceField, string>> = {}
  const fields = getStudentSubjectFields(choices.class_group)
  const selected = fields.map(field => choices[field]).filter(Boolean)

  for (const field of fields) {
    const value = choices[field]
    const fourth = field === 'group_fourth_option_id'
    if (!value) {
      if (required) errors[field] = fourth ? 'Choose a fourth subject' : 'Choose an elective subject'
    } else if (selected.filter(id => id === value).length > 1) {
      errors[field] = 'Elective and fourth subjects must all be different'
    } else if (options && !options.some(option => option.id === value
      && option.class_group === choices.class_group && option.is_active
      && (fourth ? option.available_as_fourth : option.available_as_elective))) {
      errors[field] = 'Choose an available subject for your group'
    }
  }
  return errors
}

export function hasRequiredStudentSubjects(student: Student | null | undefined) {
  return Boolean(student && ['science', 'humanities', 'business'].includes(student.class_group)
    && Object.keys(getStudentSubjectErrors(student)).length === 0)
}

export function studentSubjectUpdate(choices: StudentSubjectChoices) {
  return {
    group_elective_option_id: choices.class_group === 'business' ? choices.group_elective_option_id || null : null,
    group_fourth_option_id: choices.group_fourth_option_id || null,
    humanities_main_option_1_id: choices.class_group === 'humanities' ? choices.humanities_main_option_1_id || null : null,
    humanities_main_option_2_id: choices.class_group === 'humanities' ? choices.humanities_main_option_2_id || null : null,
    humanities_main_option_3_id: choices.class_group === 'humanities' ? choices.humanities_main_option_3_id || null : null,
    humanities_fourth_option_id: choices.class_group === 'humanities' ? choices.group_fourth_option_id || null : null,
  }
}
