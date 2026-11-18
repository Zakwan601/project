import type { Student } from '@/types/database'

export const STUDENT_REVIEW_FIELDS = [
  { key: 'photo_url', label: 'Profile photo' },
  { key: 'birth_certificate_path', label: 'Birth certificate' },
  { key: 'father_name', label: "Father's name" },
  { key: 'mother_name', label: "Mother's name" },
  { key: 'blood_group', label: 'Blood group' },
  { key: 'student_phone', label: 'Student phone' },
  { key: 'present_address', label: 'Present address' },
  { key: 'permanent_address', label: 'Permanent address' },
  { key: 'secondary_phone', label: 'Secondary mobile number' },
  { key: 'subjects', label: 'Subject choices' },
] as const
export type StudentReviewField = typeof STUDENT_REVIEW_FIELDS[number]['key']
export const SUBJECT_REVIEW_FIELDS = ['fourth_subject_id', 'optional_subject_2_id', 'group_elective_option_id', 'group_fourth_option_id', 'humanities_main_option_1_id', 'humanities_main_option_2_id', 'humanities_main_option_3_id', 'humanities_fourth_option_id'] as const
export function hasReviewValue(student: Student, key: StudentReviewField) {
  return key === 'subjects' ? SUBJECT_REVIEW_FIELDS.some(field => Boolean(student[field])) : Boolean(student[key]?.trim())
}
