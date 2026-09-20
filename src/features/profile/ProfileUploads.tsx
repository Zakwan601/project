import { useState } from 'react'
import { ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import type { Profile, Student } from '@/types/database'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const BIRTH_CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024
const PROFILE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const BIRTH_CERTIFICATE_TYPES = new Set(['application/pdf', ...PROFILE_IMAGE_TYPES])

const fileExtension = (file: File) => {
  const extensions: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }
  return extensions[file.type]
}

const profileImagePathFromUrl = (url: string | null) => {
  if (!url) return null
  const marker = '/storage/v1/object/public/profile-images/'
  const markerIndex = url.indexOf(marker)
  return markerIndex === -1 ? null : decodeURIComponent(url.slice(markerIndex + marker.length))
}

interface ProfileUploadsProps {
  profile?: Profile
  student?: Student
  userId: string
  refreshProfile: () => Promise<void>
  stacked?: boolean
}

export function ProfileUploads({ profile, student, userId, refreshProfile, stacked = false }: ProfileUploadsProps) {
  if (!profile && !student) throw new Error('A profile or student record is required')

  const avatarUrl = student?.photo_url ?? profile?.avatar_url ?? null
  const birthCertificatePath = student?.birth_certificate_path ?? profile?.birth_certificate_path ?? null
  const recordId = student?.id ?? profile!.id

  const updateMedia = async (updates: { avatar_url?: string | null; birth_certificate_path?: string | null }) => {
    if (student) {
      const studentUpdates = {
        ...(Object.hasOwn(updates, 'avatar_url') ? { photo_url: updates.avatar_url } : {}),
        ...(Object.hasOwn(updates, 'birth_certificate_path') ? { birth_certificate_path: updates.birth_certificate_path } : {}),
      }
      const { error } = await db.from('students').update(studentUpdates).eq('id', recordId)
      if (error) throw error

      if (student.profile_id) {
        const { error: profileError } = await db.from('profiles').update(updates).eq('id', student.profile_id)
        if (profileError) throw profileError
      }
      return
    }

    const { error } = await db.from('profiles').update(updates).eq('id', recordId)
    if (error) throw error
  }
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingCertificate, setUploadingCertificate] = useState(false)
  const [removingAvatar, setRemovingAvatar] = useState(false)
  const [removingCertificate, setRemovingCertificate] = useState(false)

  const uploadAvatar = async (file: File) => {
    if (!PROFILE_IMAGE_TYPES.has(file.type)) {
      toast.error('Choose a JPG, PNG, or WebP image')
      return
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      toast.error('Profile image must be 2 MB or smaller')
      return
    }

    setUploadingAvatar(true)
    const oldPath = profileImagePathFromUrl(avatarUrl)
    const path = `${userId}/avatar-${crypto.randomUUID()}.${fileExtension(file)}`
    try {
      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(path, file, { contentType: file.type, cacheControl: '3600' })
      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from('profile-images').getPublicUrl(path)
      try {
        await updateMedia({ avatar_url: publicUrlData.publicUrl })
      } catch (updateError) {
        await supabase.storage.from('profile-images').remove([path])
        throw updateError
      }

      if (oldPath && oldPath !== path) {
        await supabase.storage.from('profile-images').remove([oldPath])
      }
      await refreshProfile()
      toast.success('Profile image updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to upload profile image')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const removeAvatar = async () => {
    setRemovingAvatar(true)
    try {
      await updateMedia({ avatar_url: null })
      const oldPath = profileImagePathFromUrl(avatarUrl)
      if (oldPath) await supabase.storage.from('profile-images').remove([oldPath])
      await refreshProfile()
      toast.success('Profile image removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove profile image')
    } finally {
      setRemovingAvatar(false)
    }
  }

  const uploadBirthCertificate = async (file: File) => {
    if (!BIRTH_CERTIFICATE_TYPES.has(file.type)) {
      toast.error('Choose a PDF, JPG, PNG, or WebP file')
      return
    }
    if (file.size > BIRTH_CERTIFICATE_MAX_BYTES) {
      toast.error('Birth certificate must be 5 MB or smaller')
      return
    }

    setUploadingCertificate(true)
    const oldPath = birthCertificatePath
    const path = `${userId}/birth-certificate-${crypto.randomUUID()}.${fileExtension(file)}`
    try {
      const { error: uploadError } = await supabase.storage
        .from('birth-certificates')
        .upload(path, file, { contentType: file.type, cacheControl: '3600' })
      if (uploadError) throw uploadError

      try {
        await updateMedia({ birth_certificate_path: path })
      } catch (updateError) {
        await supabase.storage.from('birth-certificates').remove([path])
        throw updateError
      }

      if (oldPath && oldPath !== path) {
        await supabase.storage.from('birth-certificates').remove([oldPath])
      }
      await refreshProfile()
      toast.success('Birth certificate uploaded')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to upload birth certificate')
    } finally {
      setUploadingCertificate(false)
    }
  }

  const viewBirthCertificate = async () => {
    if (!birthCertificatePath) return
    const { data, error } = await supabase.storage
      .from('birth-certificates')
      .createSignedUrl(birthCertificatePath, 60)
    if (error) {
      toast.error(error.message)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const removeBirthCertificate = async () => {
    if (!birthCertificatePath) return
    setRemovingCertificate(true)
    try {
      const path = birthCertificatePath!
      await updateMedia({ birth_certificate_path: null })
      await supabase.storage.from('birth-certificates').remove([path])
      await refreshProfile()
      toast.success('Birth certificate removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove birth certificate')
    } finally {
      setRemovingCertificate(false)
    }
  }

  return (
    <div className={stacked ? "grid gap-7" : "grid gap-6 sm:grid-cols-2"}>
      <div className="space-y-2">
        <Label>Profile Image <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" asChild disabled={uploadingAvatar || removingAvatar}>
            <label className="cursor-pointer">
              {uploadingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {avatarUrl ? 'Replace Image' : 'Upload Image'}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingAvatar || removingAvatar}
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void uploadAvatar(file)
                }}
              />
            </label>
          </Button>
          {avatarUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void removeAvatar()} disabled={uploadingAvatar || removingAvatar}>
              {removingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">JPG, PNG, or WebP. Maximum 2 MB.</p>
      </div>

      <div className="space-y-2">
        <Label>Birth Certificate <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" asChild disabled={uploadingCertificate || removingCertificate}>
            <label className="cursor-pointer">
              {uploadingCertificate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {birthCertificatePath ? 'Replace' : 'Upload'}
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                disabled={uploadingCertificate || removingCertificate}
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void uploadBirthCertificate(file)
                }}
              />
            </label>
          </Button>
          {birthCertificatePath && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => void viewBirthCertificate()}>
                <FileText className="mr-2 h-4 w-4" /> View <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void removeBirthCertificate()} disabled={uploadingCertificate || removingCertificate}>
                {removingCertificate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Remove
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PDF, JPG, PNG, or WebP. Maximum 5 MB. Stored privately.</p>
      </div>
    </div>
  )
}
