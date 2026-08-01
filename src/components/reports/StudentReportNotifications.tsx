import { useState } from 'react'
import { Bell, Check, CheckCircle2, MessageSquareWarning } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useAdminStudentReports, useAdminUnreadComplaintCount, useMarkStudentReportRead, useSolveStudentReport } from '@/hooks/useStudentReports'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PaginationFooter } from '@/components/shared/PaginationFooter'

export function StudentReportNotifications() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const { data: reportPage, isLoading, isFetching, error } = useAdminStudentReports({ page, pageSize })
  const { data: unreadCount = 0 } = useAdminUnreadComplaintCount(true, false)
  const reports = reportPage?.rows ?? []
  const totalReports = reportPage?.total ?? 0
  const markRead = useMarkStudentReportRead()
  const solveReport = useSolveStudentReport()

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Complaint Inbox
              {unreadCount > 0 && <Badge variant="destructive">{unreadCount} new</Badge>}
            </CardTitle>
            <CardDescription className="mt-1">Complaints submitted by students</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Loading reports...</p>
        ) : error ? (
          <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : reports.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <MessageSquareWarning className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No complaints yet.</p>
          </div>
        ) : (
          <ScrollArea className="h-[380px]">
            <div className="divide-y">
              {reports.map(report => {
                const studentName = `${report.students.first_name} ${report.students.last_name}`.trim()
                return (
                  <div key={report.id} className={`p-4 sm:p-5 ${!report.admin_read_at ? 'bg-primary/5' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{report.subject}</p>
                          <Badge variant="outline" className="capitalize">{report.category}</Badge>
                          <Badge variant={report.status === 'resolved' ? 'default' : 'secondary'} className="capitalize">
                            {report.status === 'resolved' ? 'Solved' : report.status}
                          </Badge>
                          {!report.admin_read_at && <span className="h-2 w-2 rounded-full bg-primary" title="Unread" />}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {studentName} · {report.students.admission_number} · {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!report.admin_read_at && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => markRead.mutate(report.id)}
                            disabled={markRead.isPending}
                            title="Mark as reviewed"
                            aria-label={`Mark ${report.subject} as reviewed`}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        {report.status !== 'resolved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => solveReport.mutate(report.id)}
                            disabled={solveReport.isPending}
                          >
                            <CheckCircle2 className="mr-1.5 h-4 w-4" />
                            Solved
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{report.message}</p>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
      {!isLoading && !error && totalReports > 0 && (
        <PaginationFooter
          page={page}
          pageSize={pageSize}
          total={totalReports}
          isFetching={isFetching}
          onPageChange={setPage}
          onPageSizeChange={value => {
            setPageSize(value)
            setPage(1)
          }}
        />
      )}
    </Card>
  )
}
