import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquareWarning, Send } from 'lucide-react'
import { PageHeader, ErrorState } from '@/components/shared/PageHeader'
import { useMyStudentReports, useSubmitStudentReport } from '@/hooks/useStudentReports'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { StudentReportCategory, StudentReportStatus } from '@/types/database'

const categories: Array<{ value: StudentReportCategory; label: string }> = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'academic', label: 'Academic' },
  { value: 'safety', label: 'Safety' },
  { value: 'technical', label: 'Technical' },
  { value: 'other', label: 'Other' },
]

const statusStyles: Record<StudentReportStatus, string> = {
  submitted: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  reviewed: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
}

export function StudentReportsPage() {
  const [category, setCategory] = useState<StudentReportCategory>('attendance')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const submitReport = useSubmitStudentReport()
  const { data: reports = [], isLoading, error } = useMyStudentReports()

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    submitReport.mutate(
      { category, subject: subject.trim(), message: message.trim() },
      {
        onSuccess: () => {
          setCategory('attendance')
          setSubject('')
          setMessage('')
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report an Issue"
        description="Send a report to the school administration."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5" />
            New Report
          </CardTitle>
          <CardDescription>Administrators will receive this report in their dashboard and Discord.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="report-category">Category</Label>
                <Select value={category} onValueChange={value => setCategory(value as StudentReportCategory)}>
                  <SelectTrigger id="report-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(item => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-subject">Subject</Label>
                <Input
                  id="report-subject"
                  value={subject}
                  onChange={event => setSubject(event.target.value)}
                  minLength={3}
                  maxLength={120}
                  placeholder="Brief summary"
                  required
                />
                <p className="text-xs text-muted-foreground">Minimum 3 characters</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-message">Details</Label>
              <Textarea
                id="report-message"
                value={message}
                onChange={event => setMessage(event.target.value)}
                minLength={10}
                maxLength={2000}
                rows={6}
                placeholder="Describe what happened and include any useful details."
                required
              />
              <p className="text-right text-xs text-muted-foreground">
                Minimum 10 characters · {message.length}/2000
              </p>
            </div>
            <Button
              type="submit"
              disabled={submitReport.isPending}
            >
              <Send className="mr-1.5 h-4 w-4" />
              {submitReport.isPending ? 'Sending...' : 'Send Report'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Reports</CardTitle>
          <CardDescription>Your latest submitted reports and their status.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading reports...</p>
          ) : error ? (
            <ErrorState message={(error as Error).message} />
          ) : reports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">You have not submitted a report.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {reports.map(report => (
                <div key={report.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{report.subject}</p>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">{report.category}</p>
                    </div>
                    <Badge className={statusStyles[report.status]}>
                      {report.status === 'resolved' ? 'solved' : report.status}
                    </Badge>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{report.message}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Sent {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
