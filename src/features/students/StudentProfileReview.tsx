import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { STUDENT_REVIEW_FIELDS, hasReviewValue, type StudentReviewField } from '@/lib/studentProfileReview'
import type { Student } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export function StudentProfileReview({ student, onRemoved }: { student: Student; onRemoved: (fields: StudentReviewField[]) => Promise<void> }) {
  const [selected, setSelected] = useState<StudentReviewField[]>([])
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const fields = STUDENT_REVIEW_FIELDS.filter(field => hasReviewValue(student, field.key))
  const remove = async () => {
    if (removing || !selected.length) return
    setRemoving(true)
    try {
      const { error } = await (supabase as any).rpc('remove_student_profile_details', { p_student_id: student.id, p_fields: selected, p_reason: reason.trim() || null })
      if (error) throw error
      await onRemoved(selected)
      setSelected([])
      setReason('')
      toast.success('Information removed. A private correction notice is ready for this student.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to remove information') }
    finally { setRemoving(false) }
  }
  if (!fields.length) return null
  return <section className="space-y-3 border-t pt-4">
    <div><h3 className="text-sm font-semibold">Request profile corrections</h3><p className="mt-1 text-xs text-muted-foreground">Select saved information to remove. Only this student will see the notice; each item clears when they add the correct information again. Removal takes effect immediately.</p></div>
    <div className="grid gap-2 sm:grid-cols-2">{fields.map(field => <label key={field.key} className="flex items-center gap-2 text-sm">
      <Checkbox disabled={removing} checked={selected.includes(field.key)} onCheckedChange={checked => setSelected(current => checked === true ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}
    </label>)}</div>
    <div className="space-y-1"><Label htmlFor="profile-correction-reason">Reason for the student (optional)</Label><Input id="profile-correction-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={removing} placeholder="For example: please upload a clear, recent photo" /></div>
    <Button type="button" variant="outline" className="text-destructive" disabled={removing || !selected.length} onClick={() => setConfirming(true)}><Trash2 className="mr-2 h-4 w-4" />{removing ? 'Removing...' : 'Remove selected information'}</Button>
    <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove selected profile information?</AlertDialogTitle><AlertDialogDescription>This clears {selected.map(key => STUDENT_REVIEW_FIELDS.find(field => field.key === key)?.label).join(', ')} and asks this student to provide it again. Other unsaved changes in this form are kept.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>Remove and notify student</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
