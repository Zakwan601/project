import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { AutosaveStatus } from '@/components/shared/AutosaveStatus'
import { useAutosave } from '@/hooks/useAutosave'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getStudentSubjectErrors, getStudentSubjectFields, studentSubjectUpdate, type StudentSubjectChoices } from '@/lib/studentSubjects'
import type { Student, Subject, SubjectCourseOption } from '@/types/database'
import { createSubjectNameLookup, type SubjectPaperGroupName } from '@/lib/subjectNames'

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
  const papers = options.flatMap(option => [
    subjectById.get(option.first_paper_subject_id),
    subjectById.get(option.second_paper_subject_id),
  ]).filter((paper): paper is Subject => Boolean(paper))

  return <SubjectList title={title} subjects={papers} emptyText={emptyText} />
}

export function StudentSubjects({ student }: StudentSubjectsProps) {
  const { user, applySavedProfileChanges } = useAuth()
  const queryClient = useQueryClient()
  const [choices, setChoices] = useState<StudentSubjectChoices>(student)
  const identity = `${student.id}:${student.class_group}`
  const identityRef = useRef(identity)
  const studentId = student.id
  const userId = user?.id
  const saveSubjectChanges = useCallback(async (updates: ReturnType<typeof studentSubjectUpdate>) => {
    if (!userId) throw new Error('Please sign in again')
    const { data, error } = await db.from('students').update(updates)
      .eq('id', studentId).eq('profile_id', userId)
      .select(['id', ...Object.keys(updates), 'fourth_subject_id', 'optional_subject_2_id'].join(',')).single()
    if (error) throw new Error(error.message || 'Unable to save subjects')
    applySavedProfileChanges(userId, {}, data)
    void queryClient.invalidateQueries({ queryKey: ['students'] })
  }, [studentId, userId, applySavedProfileChanges, queryClient])
  const autosave = useAutosave(saveSubjectChanges)

  useEffect(() => {
    // Confirmed saves update AuthContext; preserve edits made while a request was pending.
    if (identityRef.current !== identity) {
      setChoices(student)
      identityRef.current = identity
    }
  }, [student, identity])

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
    queryFn: async () => {
      const { data, error } = await db.from('subject_course_options').select('*')
        .eq('class_group', student.class_group)
        .eq('is_active', true)
      if (error) throw error
      return data as SubjectCourseOption[]
    },
  })

  const paperNamesQuery = useQuery<SubjectPaperGroupName[]>({
    queryKey: ['profile-subject-paper-names', student.class_group],
    queryFn: async () => {
      const { data, error } = await db.from('result_subject_paper_groups')
        .select('class_group,name,first_paper_subject_id,second_paper_subject_id')
        .eq('class_group', student.class_group)
      if (error) throw error
      return data as SubjectPaperGroupName[]
    },
  })

  if (subjectsQuery.isLoading || optionsQuery.isLoading || paperNamesQuery.isLoading) {
    return (
      <section id="profile-subjects" tabIndex={-1} className="scroll-mt-20 border-t pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subjects...
        </div>
      </section>
    )
  }

  if (subjectsQuery.error || optionsQuery.error || paperNamesQuery.error) {
    return (
      <section id="profile-subjects" tabIndex={-1} className="scroll-mt-20 border-t pt-6">
        <h2 className="text-base font-semibold">Subjects</h2>
        <p className="mt-2 text-sm text-destructive">Subjects could not be loaded.</p>
      </section>
    )
  }

  const names = createSubjectNameLookup(paperNamesQuery.data ?? [])
  const subjects = (subjectsQuery.data ?? []).map(subject => ({ ...subject, name: names.subjectName(subject) }))
  const options = (optionsQuery.data ?? []).map(option => ({ ...option, name: names.courseName(option) }))
  const compulsory = subjects.filter(subject => !subject.is_fourth_subject)
  const fields = getStudentSubjectFields(student.class_group)
  const errors = getStudentSubjectErrors(choices, options)
  const savedErrors = getStudentSubjectErrors(student, options)
  const needsSubjects = Object.keys(savedErrors).length > 0
  const groupLabel = student.class_group === 'business' ? 'Business Studies'
    : student.class_group === 'humanities' ? 'Humanities' : 'Science'
  const optionById = new Map(options.map(option => [option.id, option]))
  const fourthOption = optionById.get(choices.group_fourth_option_id ?? '')
  const mainOptions = student.class_group === 'science'
    ? options.filter(option => option.available_as_fourth && option.id !== choices.group_fourth_option_id)
    : fields.filter(field => field !== 'group_fourth_option_id')
      .map(field => optionById.get(choices[field] ?? ''))
      .filter((option): option is SubjectCourseOption => Boolean(option))

  return (
    <section id="profile-subjects" tabIndex={-1} className="scroll-mt-20 space-y-5 border-t pt-6">
      <div>
        <h2 className="text-base font-semibold">Subjects</h2>
        <p className={`mt-1 text-sm ${needsSubjects ? 'text-destructive' : 'text-muted-foreground'}`}>{groupLabel} · Required to complete your profile.</p>
        <p className={`mt-2 text-sm ${needsSubjects ? 'text-destructive' : 'text-muted-foreground'}`}>
          {student.class_group === 'humanities'
            ? 'Choose three different electives and a different fourth subject. Both papers follow each choice.'
            : student.class_group === 'business'
              ? 'Choose one elective and a different fourth subject. Both papers follow each choice.'
              : 'Choose Biology or Higher Mathematics as your fourth subject. The other course remains a main subject. Both papers follow your choice.'}
        </p>
      </div>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field, index) => {
            const fourth = field === 'group_fourth_option_id'
            const label = fourth ? 'Fourth subject' : student.class_group === 'humanities' ? `Elective subject ${index + 1}` : 'Elective subject'
            const available = options.filter(option => (fourth ? option.available_as_fourth : option.available_as_elective)
              && !fields.some(other => other !== field && choices[other] === option.id))
            const error = choices[field] ? errors[field] : undefined
            return (
              <div key={field} className="space-y-2">
                <Label htmlFor={`profile-${field}`} className={savedErrors[field] ? 'text-destructive' : undefined}>{label} (required)</Label>
                <Select value={choices[field] ?? ''} onValueChange={value => {
                  const next = { ...choices, [field]: value }
                  setChoices(next)
                  if (Object.keys(getStudentSubjectErrors(next, options, false)).length === 0) {
                    autosave.enqueue(studentSubjectUpdate(next))
                  }
                }}>
                  <SelectTrigger id={`profile-${field}`} className="h-auto! min-h-9 w-full py-2 text-left [&_[data-slot=select-value]]:line-clamp-none! [&_[data-slot=select-value]]:whitespace-normal" aria-required="true" aria-invalid={Boolean(error)} aria-describedby={error ? `${field}-error` : undefined}>
                    <SelectValue placeholder="Choose subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map(option => <SelectItem key={option.id} value={option.id} textValue={option.name} className="max-w-[calc(100vw-3rem)] whitespace-normal break-words">{option.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {error && <p id={`${field}-error`} className="text-xs text-destructive">{error}</p>}
              </div>
            )
          })}
        </div>
        <AutosaveStatus {...autosave} />
      </div>
      <SubjectList title="Compulsory subjects" subjects={compulsory} emptyText="No compulsory subjects found." />
      <CourseList title={student.class_group === 'science' ? 'Other main course' : 'Elective subjects'} options={mainOptions} subjects={subjects} emptyText="Choose your subjects above." />
      <CourseList title="Fourth subject" options={fourthOption ? [fourthOption] : []} subjects={subjects} emptyText="A fourth subject has not been assigned." />
    </section>
  )
}
