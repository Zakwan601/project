import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { announcementsService, type CreateAnnouncementInput } from '@/services/announcements'

export const ANNOUNCEMENTS_KEY = 'announcements'

export function useActiveAnnouncements() {
  return useQuery({
    queryKey: [ANNOUNCEMENTS_KEY, 'active'],
    queryFn: () => announcementsService.getActive(5),
  })
}

export function useAdminAnnouncements() {
  return useQuery({
    queryKey: [ANNOUNCEMENTS_KEY, 'admin'],
    queryFn: announcementsService.getAll,
  })
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAnnouncementInput) => announcementsService.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ANNOUNCEMENTS_KEY] })
      toast.success('Announcement posted')
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: announcementsService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ANNOUNCEMENTS_KEY] })
      toast.success('Announcement removed')
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
