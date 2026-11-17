import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { STUDENT_REVIEW_FIELDS, type StudentReviewField } from '@/lib/studentProfileReview'

type ReviewNotice = { field_key: StudentReviewField; reason: string | null }
export function StudentProfileReviewNotice({ onEdit }: { onEdit?: (field: StudentReviewField) => void }) {
  const { role, student } = useAuth()
  const { data } = useQuery({
    queryKey: ['student-profile-review', student?.id, student],
    enabled: role === 'student' && Boolean(student?.id),
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('student_profile_review_notices')
        .select('field_key,reason').eq('student_id', student!.id).order('created_at')
      if (error) throw error
      return data as ReviewNotice[]
    },
  })
  if (role !== 'student' || !data?.length) return null
  return <section className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm" aria-label="Profile corrections" aria-live="polite">
    <p className="flex items-center gap-2 font-semibold text-destructive"><AlertCircle className="h-4 w-4" /> Update your profile</p>
    <p className="mt-1 text-muted-foreground">An administrator removed the following information. Add the correct details again to clear each notice.</p>
    <ul className="mt-2 space-y-1">
      {data.map(notice => <li key={notice.field_key}>
        {onEdit ? <button type="button" className="font-medium text-destructive underline underline-offset-2" onClick={() => onEdit(notice.field_key)}>{STUDENT_REVIEW_FIELDS.find(field => field.key === notice.field_key)?.label ?? 'Profile information'}</button>
          : <Link className="font-medium text-destructive underline underline-offset-2" to={`/profile?review=${notice.field_key}`}>{STUDENT_REVIEW_FIELDS.find(field => field.key === notice.field_key)?.label ?? 'Profile information'}</Link>}
        {notice.reason && <span className="ml-2 text-muted-foreground">{notice.reason}</span>}
      </li>)}
    </ul>
  </section>
}
