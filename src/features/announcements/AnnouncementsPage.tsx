import { useState } from 'react'
import { format } from 'date-fns'
import { Megaphone, Send, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { useAdminAnnouncements, useCreateAnnouncement, useDeleteAnnouncement } from '@/hooks/useAnnouncements'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDisplayDate } from '@/lib/dateTime'
import { DatePickerInput } from '@/components/shared/DatePickerInput'

export function AnnouncementsPage() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const { data: announcements = [], isLoading, error } = useAdminAnnouncements()
  const createAnnouncement = useCreateAnnouncement()
  const deleteAnnouncement = useDeleteAnnouncement()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    createAnnouncement.mutate(
      { title: title.trim(), message: message.trim(), expires_at: expiresAt || null },
      {
        onSuccess: () => {
          setTitle('')
          setMessage('')
          setExpiresAt('')
        },
      },
    )
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      <PageHeader title="Announcements" description="Post simple notices for students." />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Megaphone /> New Announcement</CardTitle>
          <CardDescription>It will appear on every student dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <div className="space-y-1.5">
                <Label htmlFor="announcement-title">Title</Label>
                <Input
                  id="announcement-title"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  maxLength={120}
                  placeholder="School notice"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="announcement-expiry">Expiry (optional)</Label>
                <DatePickerInput
                  id="announcement-expiry"
                  min={format(new Date(), 'yyyy-MM-dd')}
                  value={expiresAt}
                  onChange={setExpiresAt}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="announcement-message">Message</Label>
              <Textarea
                id="announcement-message"
                value={message}
                onChange={event => setMessage(event.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Write the announcement..."
                required
              />
            </div>
            <Button type="submit" disabled={!title.trim() || !message.trim() || createAnnouncement.isPending}>
              <Send /> {createAnnouncement.isPending ? 'Posting…' : 'Post Announcement'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posted Announcements</CardTitle>
          <CardDescription>Newest announcements appear first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-5 text-sm text-muted-foreground">Loading announcements...</p>
          ) : error ? (
            <p className="py-5 text-sm text-destructive">{(error as Error).message}</p>
          ) : announcements.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">No announcements posted yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {announcements.map(announcement => {
                const expired = Boolean(announcement.expires_at && announcement.expires_at < format(new Date(), 'yyyy-MM-dd'))
                return (
                  <article key={announcement.id} className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{announcement.title}</h3>
                          <Badge variant={expired ? 'secondary' : 'outline'}>{expired ? 'Expired' : 'Active'}</Badge>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{announcement.message}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Posted {formatDisplayDate(announcement.created_at)}
                          {announcement.expires_at ? ` · Expires ${formatDisplayDate(announcement.expires_at)}` : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="shrink-0 text-destructive hover:text-destructive"
                        disabled={deleteAnnouncement.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove “${announcement.title}”?`)) deleteAnnouncement.mutate(announcement.id)
                        }}
                        aria-label={`Remove ${announcement.title}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
