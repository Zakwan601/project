import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Student, Subject, SubjectCourseOption } from '@/types/database'

// Database types are maintained manually in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface StudentSubjectsProps {
  student: Student
}

function SubjectList({ title, subjects, emptyText }: {
  title: string
  subjects: Subject[]
  emptyText: string
}) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {subjects.length > 0 ? (
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
          {subjects.map(subject => (
            <li key={subject.id} className="flex justify-between gap-3 py-1">
              <span>{subject.name}</span>
              <span className="shrink-0 font-mono text-xs">{subject.code}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

function CourseList({ title, options, subjects, emptyText }: {
  title: string
  options: SubjectCourseOption[]
  subjects: Subject[]
  emptyText: string
}) {
  const subjectById = new Map(subjects.map(subject => [subject.id, subject]))
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {options.length > 0 ? (
        <div className="mt-2 space-y-3">
          {options.map(option => {
            const papers = [
              subjectById.get(option.first_paper_subject_id),
              subjectById.get(option.second_paper_subject_id),
            ].filter((paper): paper is Subject => Boolean(paper))
            return (
              <div key={option.id}>
                <p className="text-sm">{option.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {papers.map(paper => `${paper.name} (${paper.code})`).join(' · ')}
                </p>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

export function StudentSubjects({ student }: StudentSubjectsProps) {
  const subjectsQuery = useQuery<Subject[]>({
    queryKey: ['profile-subjects', student.class_group],
    queryFn: async () => {
      const { data, error } = await db.from('subjects').select('*')
        .eq('class_group', student.class_group)
        .eq('is_active', true)
        .order('name')
        .order('code')
      if (error) throw error
      return data as Subject[]
    },
  })

  const optionsQuery = useQuery<SubjectCourseOption[]>({
    queryKey: ['profile-subject-course-options', student.class_group],
    enabled: student.class_group === 'humanities',
    queryFn: async () => {
      const { data, error } = await db.from('subject_course_options').select('*')
        .eq('class_group', student.class_group)
        .eq('is_active', true)
      if (error) throw error
      return data as SubjectCourseOption[]
    },
  })

  if (subjectsQuery.isLoading || optionsQuery.isLoading) {
    return (
      <section className="border-t pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subjects...
        </div>
      </section>
    )
  }

  if (subjectsQuery.error || optionsQuery.error) {
    return (
      <section className="border-t pt-6">
        <h2 className="text-base font-semibold">Subjects</h2>
        <p className="mt-2 text-sm text-destructive">Subjects could not be loaded.</p>
      </section>
    )
  }

  const subjects = subjectsQuery.data ?? []
  const options = optionsQuery.data ?? []
  const compulsory = subjects.filter(subject => !subject.is_fourth_subject)

  if (student.class_group === 'humanities') {
    const optionById = new Map(options.map(option => [option.id, option]))
    const mainOptions = [
      student.humanities_main_option_1_id,
      student.humanities_main_option_2_id,
      student.humanities_main_option_3_id,
    ].map(id => id ? optionById.get(id) : undefined)
      .filter((option): option is SubjectCourseOption => Boolean(option))
    const fourthOption = student.humanities_fourth_option_id
      ? optionById.get(student.humanities_fourth_option_id)
      : undefined

    return (
      <section className="space-y-5 border-t pt-6">
        <div>
          <h2 className="text-base font-semibold">Subjects</h2>
          <p className="mt-1 text-sm text-muted-foreground">Humanities · Read only</p>
        </div>
        <SubjectList title="Compulsory subjects" subjects={compulsory} emptyText="No compulsory subjects found." />
        <CourseList title="Main electives (Group A)" options={mainOptions} subjects={subjects} emptyText="Main electives have not been assigned." />
        <CourseList title="Fourth subject (Group B)" options={fourthOption ? [fourthOption] : []} subjects={subjects} emptyText="A fourth subject has not been assigned." />
      </section>
    )
  }

  const fourthIds = new Set([student.fourth_subject_id, student.optional_subject_2_id].filter(Boolean))
  const mainGroupSubjects = subjects.filter(subject => subject.is_fourth_subject && !fourthIds.has(subject.id))
  const fourthSubjects = subjects.filter(subject => fourthIds.has(subject.id))

  return (
    <section className="space-y-5 border-t pt-6">
      <div>
        <h2 className="text-base font-semibold">Subjects</h2>
        <p className="mt-1 text-sm capitalize text-muted-foreground">
          {student.class_group === 'business' ? 'Business studies' : student.class_group} · Read only
        </p>
      </div>
      <SubjectList title="Compulsory subjects" subjects={compulsory} emptyText="No compulsory subjects found." />
      <SubjectList title="Main group subject" subjects={mainGroupSubjects} emptyText="No main group subject is assigned." />
      <SubjectList title="Fourth subject" subjects={fourthSubjects} emptyText="A fourth subject has not been assigned." />
    </section>
  )
}
