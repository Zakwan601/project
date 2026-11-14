import type { ClassGroup, Subject, SubjectCourseOption } from '@/types/database'

export interface SubjectPaperGroupName {
  class_group: ClassGroup
  name: string
  first_paper_subject_id: string
  second_paper_subject_id: string
}

const hasBangla = (name: string) => /[\u0980-\u09ff]/u.test(name)

export function createSubjectNameLookup(groups: SubjectPaperGroupName[]) {
  const courses = new Map<string, string>()
  const papers = new Map<string, string>()
  for (const group of groups) {
    // These records also supply labels when disabled for combined-paper exams.
    const bangla = group.name.match(/\(([^()]*[\u0980-\u09ff][^()]*)\)\s*$/u)?.[1]?.trim()
    if (!bangla) continue
    courses.set(`${group.class_group}:${group.first_paper_subject_id}:${group.second_paper_subject_id}`, group.name)
    papers.set(`${group.class_group}:${group.first_paper_subject_id}`, `${bangla} ১ম পত্র`)
    papers.set(`${group.class_group}:${group.second_paper_subject_id}`, `${bangla} ২য় পত্র`)
  }

  return {
    courseName(option: Pick<SubjectCourseOption, 'class_group' | 'name' | 'first_paper_subject_id' | 'second_paper_subject_id'>) {
      return courses.get(`${option.class_group}:${option.first_paper_subject_id}:${option.second_paper_subject_id}`) ?? option.name
    },
    subjectName(subject: Pick<Subject, 'id' | 'class_group' | 'name'>) {
      if (hasBangla(subject.name)) return subject.name
      const bangla = papers.get(`${subject.class_group}:${subject.id}`)
      return bangla ? `${subject.name} (${bangla})` : subject.name
    },
  }
}
