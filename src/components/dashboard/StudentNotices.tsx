import { addMonths, format } from 'date-fns'
import { CalendarDays, Megaphone } from 'lucide-react'
import { useActiveAnnouncements } from '@/hooks/useAnnouncements'
import { useHolidays } from '@/hooks/useHolidays'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDisplayDate } from '@/lib/dateTime'
import { Skeleton } from '@/components/ui/skeleton'

export function StudentNotices() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const endDate = format(addMonths(new Date(), 6), 'yyyy-MM-dd')
  const { data: announcements = [], isLoading: announcementsLoading } = useActiveAnnouncements()
  const { data: holidays = [], isLoading: holidaysLoading } = useHolidays(today, endDate)

  return (
    <div className="grid gap-3 lg:grid-cols-2 sm:gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Megaphone /> Announcements</CardTitle>
          <CardDescription>Latest notices from the school</CardDescription>
        </CardHeader>
        <CardContent>
          {announcementsLoading ? (
            <NoticeListSkeleton />
          ) : announcements.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No current announcements.</p>
          ) : (
            <div className="divide-y">
              {announcements.map(announcement => (
                <article key={announcement.id} className="py-3 first:pt-0 last:pb-0">
                  <h3 className="text-sm font-semibold">{announcement.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{announcement.message}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {formatDisplayDate(announcement.created_at)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><CalendarDays /> Upcoming Holidays</CardTitle>
          <CardDescription>School holidays in the next six months</CardDescription>
        </CardHeader>
        <CardContent>
          {holidaysLoading ? (
            <NoticeListSkeleton holiday />
          ) : holidays.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No upcoming holidays listed.</p>
          ) : (
            <div className="divide-y">
              {holidays.slice(0, 5).map(holiday => (
                <article key={holiday.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-24 rounded-lg bg-blue-500/10 px-2 py-2 text-center text-blue-700 dark:text-blue-300">
                    <p className="text-xs font-bold leading-none">{formatDisplayDate(holiday.date)}</p>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{holiday.name}</h3>
                    {holiday.description && <p className="mt-0.5 text-xs text-muted-foreground">{holiday.description}</p>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function NoticeListSkeleton({ holiday = false }: { holiday?: boolean }) {
  return (
    <div className="space-y-4 py-1">
      {[0, 1, 2].map(item => (
        <div key={item} className="flex items-start gap-3">
          {holiday && <Skeleton className="h-8 w-24 shrink-0 rounded-lg" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-full" />
            {!holiday && <Skeleton className="h-3 w-20" />}
          </div>
        </div>
      ))}
    </div>
  )
}
