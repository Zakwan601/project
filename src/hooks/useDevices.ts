import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesService } from '@/services/devices'
import type { Device } from '@/types/database'
import { toast } from 'sonner'

export const DEVICES_KEY = 'devices'

export function useDevices() {
  return useQuery({
    queryKey: [DEVICES_KEY],
    queryFn: () => devicesService.getAll(),
    refetchInterval: 60_000,
  })
}

export function useCreateDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: Omit<Device, 'id' | 'created_at' | 'updated_at'>) => devicesService.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Device added successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Device> }) =>
      devicesService.update(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Device updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => devicesService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Device removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
