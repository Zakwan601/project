import { useQuery, useQueryClient } from '@tanstack/react-query'
import { StudentProfileReviewNotice } from '@/components/dashboard/StudentProfileReviewNotice'
import { AUTH_CAPTCHA_ENABLED } from '@/lib/authCaptcha'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, Check, Circle, Clock3, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { getSubAdminLabel } from '@/lib/subAdminLabel'
import { hasProfilePhoto, isProfileComplete, isValidBangladeshMobile, normalizeBangladeshMobile } from '@/lib/profile'
import { hasRequiredStudentSubjects } from '@/lib/studentSubjects'
import { Link } from 'react-router-dom'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import { toast } from 'sonner'
import { LoadingState, PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStudentEnrollmentHistory } from '@/hooks/useStudents'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { ProfileUploads } from './ProfileUploads'
import { StudentSubjects } from './StudentSubjects'
import { useAutosave } from '@/hooks/useAutosave'
import { AutosaveStatus } from '@/components/shared/AutosaveStatus'
import type { Profile, Student } from '@/types/database'

const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || undefined

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
const profileTabClassName = 'h-8 min-w-0 rounded-none px-1 text-[11px] sm:h-10 sm:px-3 sm:text-sm text-muted-foreground shadow-none hover:bg-background/60 hover:text-foreground data-[state=active]:border-transparent! data-[state=active]:bg-primary! data-[state=active]:text-primary-foreground! data-[state=active]:font-semibold'

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Required'),
  phone: z.string()
    .trim()
    .min(1, 'Phone is required')
    .refine(isValidBangladeshMobile, 'Enter a valid Bangladesh mobile number'),
  student_phone: z.string().trim(),
  present_address: z.string().trim().max(1000, 'Use 1,000 characters or fewer'),
  permanent_address: z.string().trim().max(1000, 'Use 1,000 characters or fewer'),
  father_name: z.string().trim().max(120, 'Use 120 characters or fewer'),
  mother_name: z.string().trim().max(120, 'Use 120 characters or fewer'),
  blood_group: z.enum(BLOOD_GROUPS).or(z.literal('')),
  secondary_phone: z.string().trim().refine(
    value => !value || isValidBangladeshMobile(value),
    'Enter a valid Bangladesh mobile number',
  ),
})
const studentProfileSchema = profileSchema.extend({
  phone: z.string(),
  student_phone: z.string().trim().min(1, 'Student phone is required').refine(isValidBangladeshMobile, 'Enter a valid Bangladesh mobile number'),
  present_address: z.string().trim().min(1, 'Present address is required').max(1000, 'Use 1,000 characters or fewer'),
  permanent_address: z.string().trim().min(1, 'Permanent address is required').max(1000, 'Use 1,000 characters or fewer'),
})
type ProfileForm = z.infer<typeof profileSchema>
type PersonalUpdates = Partial<Pick<Profile, 'full_name' | 'phone' | 'father_name' | 'mother_name' | 'blood_group' | 'secondary_phone'> & Pick<Student, 'student_phone' | 'present_address' | 'permanent_address'>>

const passwordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password required'),
  newPassword: z.string()
    .min(8, 'Use at least 8 characters')
    .regex(/[a-z]/, 'Add a lowercase letter')
    .regex(/[A-Z]/, 'Add an uppercase letter')
    .regex(/[0-9]/, 'Add a number')
    .regex(/[^A-Za-z0-9]/, 'Add a symbol'),
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type PasswordForm = z.infer<typeof passwordSchema>

const passwordRequirements = [
  { label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { label: 'One uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'One lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'One number', test: (value: string) => /[0-9]/.test(value) },
  { label: 'One symbol', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

export function ProfilePage() {
  const { profile, student, user, refreshProfile, applySavedProfileChanges, role, loading, profileError } = useAuth()
  const openAccountQuery = useQuery({
    queryKey: ['staff-open-account', user?.id],
    enabled: !!user && role === 'sub_admin',
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('is_open_account').eq('id', user!.id).single()
      if (error) throw error
      return (data as Pick<Profile, 'is_open_account'>).is_open_account
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const passwordLocked = role === 'sub_admin' && (openAccountQuery.data ?? profile?.is_open_account ?? false)
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('review') === 'subjects' ? 'academics' : 'personal')
  const [changingPwd, setChangingPwd] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState({ old: false, new: false, confirm: false })
  const passwordTurnstileRef = useRef<TurnstileInstance>(null)
  const passwordTurnstileRejectRef = useRef<((error: Error) => void) | null>(null)
  const passwordTurnstileFailedRef = useRef(false)
  const passwordTurnstileResetAttemptedRef = useRef(false)
  const phoneManagedByAdmin = role === 'student'
  const needsPhoto = role === 'student' && !hasProfilePhoto(profile, student)
  const needsSubjects = role === 'student' && !hasRequiredStudentSubjects(student)
  const profileComplete = isProfileComplete(profile, student)
  const missingContactField = !isValidBangladeshMobile(student?.student_phone) ? 'student_phone' : !student?.present_address?.trim() ? 'present_address' : !student?.permanent_address?.trim() ? 'permanent_address' : null
  const avatarUrl = student?.photo_url ?? profile?.avatar_url
  const personalIdentityRef = useRef<string | null>(null)
  const profileId = profile?.id
  const studentId = student?.id
  const queryClient = useQueryClient()
  const savePersonalChanges = useCallback(async (updates: PersonalUpdates) => {
    if (!profileId) throw new Error('Profile unavailable')
    if (role === 'student') {
      if (!studentId) throw new Error('Student profile unavailable')
      const { full_name, phone: _guardianPhone, ...details } = updates
      const nameParts = full_name?.trim().split(/\s+/u)
      const studentUpdates = {
        ...details,
        ...(nameParts ? { first_name: nameParts[0], last_name: nameParts.slice(1).join(' ') } : {}),
      }
      const { data, error } = await db.from('students').update(studentUpdates)
        .eq('id', studentId).eq('profile_id', profileId)
        .select(['id', ...Object.keys(studentUpdates)].join(',')).single()
      if (error) throw new Error(error.message || 'Unable to save profile')
      const syncedFields = ['father_name', 'mother_name', 'blood_group', 'secondary_phone']
      const profileChanges = Object.fromEntries(Object.entries(data).filter(([key]) => syncedFields.includes(key))) as Partial<Profile>
      if (nameParts) profileChanges.full_name = [data.first_name, data.last_name].filter(Boolean).join(' ')
      applySavedProfileChanges(profileId, profileChanges, data)
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      return
    }
    const { data, error } = await db.from('profiles').update(updates).eq('id', profileId)
      .select(['id', ...Object.keys(updates)].join(',')).single()
    if (error) throw new Error(error.message || 'Unable to save profile')
    const syncedFields = ['father_name', 'mother_name', 'blood_group', 'secondary_phone']
    const studentChanges = Object.fromEntries(Object.entries(data).filter(([key]) => syncedFields.includes(key))) as Partial<Student>
    applySavedProfileChanges(profileId, data, studentChanges)
  }, [profileId, studentId, role, applySavedProfileChanges, queryClient])
  const personalAutosave = useAutosave(savePersonalChanges, 350)

  const queuePersonalField = (field: keyof ProfileForm, value: string) => {
    if (role === 'student' && field === 'phone') return
    const parsed = (role === 'student' ? studentProfileSchema : profileSchema).shape[field].safeParse(value)
    if (!parsed.success) return
    const normalized = field === 'phone' || field === 'secondary_phone' || field === 'student_phone'
      ? parsed.data ? normalizeBangladeshMobile(parsed.data) : null
      : parsed.data || null
    personalAutosave.enqueue({ [field]: normalized } as PersonalUpdates)
  }

  const goToPhotoUpload = () => {
    setActiveTab('personal')
    requestAnimationFrame(() => {
      const photoInput = document.getElementById('profile-photo-upload')
      photoInput?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      photoInput?.focus({ preventScroll: true })
    })
  }
  const goToSubjects = () => {
    setActiveTab('academics')
    requestAnimationFrame(() => {
      const section = document.getElementById('profile-subjects')
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      section?.focus({ preventScroll: true })
    })
  }
  const { data: enrollmentHistory = [], isLoading: historyLoading } = useStudentEnrollmentHistory(
    role === 'student' ? student?.id : undefined,
  )

  const {
    register: regProfile,
    reset: resetProfile,
    watch: watchProfile,
    setValue: setProfileValue,
    formState: { errors: profileErrors, dirtyFields: profileDirtyFields },
  } = useForm<ProfileForm>({
    resolver: zodResolver(role === 'student' ? studentProfileSchema : profileSchema),
    mode: 'onChange',
    defaultValues: {
      full_name: role === 'student' && student
        ? `${student.first_name} ${student.last_name}`.trim()
        : profile?.full_name ?? '',
      phone: role === 'student' ? student?.guardian_phone ?? '' : profile?.phone ?? '',
      father_name: profile?.father_name ?? '',
      mother_name: profile?.mother_name ?? '',
      blood_group: profile?.blood_group ?? '',
      secondary_phone: profile?.secondary_phone ?? '',
      student_phone: student?.student_phone ?? '',
      present_address: student?.present_address ?? '',
      permanent_address: student?.permanent_address ?? '',
    },
  })

  useEffect(() => {
    resetProfile({
      full_name: role === 'student' && student
        ? `${student.first_name} ${student.last_name}`.trim()
        : profile?.full_name ?? '',
      phone: role === 'student' ? student?.guardian_phone ?? '' : profile?.phone ?? '',
      father_name: profile?.father_name ?? '',
      mother_name: profile?.mother_name ?? '',
      blood_group: profile?.blood_group ?? '',
      secondary_phone: profile?.secondary_phone ?? '',
      student_phone: student?.student_phone ?? '',
      present_address: student?.present_address ?? '',
      permanent_address: student?.permanent_address ?? '',
    }, {
      keepDirtyValues: personalIdentityRef.current === profile?.id,
      keepErrors: personalIdentityRef.current === profile?.id,
    })
    personalIdentityRef.current = profile?.id ?? null
  }, [profile, resetProfile, role, student])

  const { register: regPwd, handleSubmit: handlePwd, reset: resetPwd, watch: watchPwd, formState: { errors: pwdErrors } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
  })

  const newPassword = watchPwd('newPassword')
  const confirmPassword = watchPwd('confirmPassword')
  const parentPhone = watchProfile('phone')
  const secondaryPhone = watchProfile('secondary_phone')
  const bloodGroup = watchProfile('blood_group')
  const parentPhoneIsValid = isValidBangladeshMobile(parentPhone)
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword
  const metRequirements = passwordRequirements.filter(requirement => requirement.test(newPassword)).length
  const passwordStrength = metRequirements <= 2
    ? { label: 'Weak', color: 'bg-destructive', text: 'text-destructive' }
    : metRequirements < passwordRequirements.length
      ? { label: 'Almost there', color: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
      : { label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }

  const togglePasswordVisibility = (field: keyof typeof visiblePasswords) => {
    setVisiblePasswords(current => ({ ...current, [field]: !current[field] }))
  }

  const handlePasswordTurnstileFailure = () => {
    passwordTurnstileFailedRef.current = true
    passwordTurnstileRejectRef.current?.(new Error('Security verification failed'))
    passwordTurnstileRejectRef.current = null

    if (!passwordTurnstileResetAttemptedRef.current) {
      passwordTurnstileResetAttemptedRef.current = true
      window.setTimeout(() => passwordTurnstileRef.current?.reset(), 0)
    }
  }

  const getPasswordTurnstileToken = async () => {
    if (!turnstileSiteKey) throw new Error('Security verification is not configured')

    const widget = passwordTurnstileRef.current
    if (!widget) throw new Error('Security verification is still loading')

    if (passwordTurnstileFailedRef.current || widget.isExpired()) {
      passwordTurnstileFailedRef.current = false
      widget.reset()
    }

    const existingToken = widget.getResponse()
    if (existingToken) return existingToken

    let rejectFailure: ((error: Error) => void) | null = null
    const failure = new Promise<string>((_resolve, reject) => {
      rejectFailure = reject
      passwordTurnstileRejectRef.current = reject
    })

    try {
      return await Promise.race([
        widget.getResponsePromise(30_000),
        failure,
      ])
    } finally {
      if (passwordTurnstileRejectRef.current === rejectFailure) {
        passwordTurnstileRejectRef.current = null
      }
    }
  }

  const changePassword = async (data: PasswordForm) => {
    if (passwordLocked) {
      toast.error('Password changes are disabled for this open account. Contact an administrator.')
      return
    }
    setChangingPwd(true)
    passwordTurnstileResetAttemptedRef.current = false
    try {
      // Verify old password by re-authenticating
      const captchaToken = AUTH_CAPTCHA_ENABLED ? await getPasswordTurnstileToken() : undefined
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: data.oldPassword,
        options: AUTH_CAPTCHA_ENABLED ? { captchaToken } : undefined,
      })
      if (verifyErr) {
        const status = 'status' in verifyErr ? Number(verifyErr.status) : 0
        const code = 'code' in verifyErr ? String(verifyErr.code) : ''
        const message = verifyErr.message.toLowerCase()
        if (status === 403 || code === 'captcha_failed' || /captcha|turnstile|security verification/.test(message)) {
          toast.error('Security verification failed. Please try again.')
        } else if (/network|fetch|connection|timeout/.test(message)) {
          toast.error('Unable to verify your password. Check your connection and try again.')
        } else {
          toast.error('Current password is incorrect')
        }
        return
      }

      // Update to new password
      const { error } = await supabase.auth.updateUser({ password: data.newPassword })
      if (error) throw error
      toast.success('Password changed successfully')
      resetPwd()
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      toast.error(/security verification|turnstile|timed out|still loading|not configured/i.test(message)
        ? 'Security verification failed. Please try again.'
        : message || 'Unable to change password. Please try again.')
    } finally {
      passwordTurnstileRef.current?.reset()
      setChangingPwd(false)
    }
  }

  const displayName = role === 'student' && student
    ? `${student.first_name} ${student.last_name}`.trim()
    : profile?.full_name ?? ''

  const initials = displayName
    ? displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const roleColors: Record<string, string> = {
    admin: 'bg-destructive text-destructive-foreground',
    sub_admin: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    student: 'bg-secondary text-secondary-foreground',
  }

  if (loading || (!profile && !profileError)) {
    return (
      <div className="max-w-3xl space-y-3 sm:space-y-6">
        <PageHeader title="Profile" description="Loading your account information" />
        <Card>
          <CardContent>
            <LoadingState message="Loading your profile..." />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-3xl space-y-3 sm:space-y-6">
        <PageHeader title="Profile" description="Manage your personal information and security" />
        <Card>
          <CardHeader>
            <CardTitle>Profile unavailable</CardTitle>
            <CardDescription>
              You are signed in, but your profile data could not be loaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {profileError || 'Please check your connection and try again.'}
            </p>
            <Button type="button" onClick={() => void refreshProfile().catch(() => undefined)}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }
  return (
    <div className="w-full max-w-6xl">
      <StudentProfileReviewNotice onEdit={field => {
        setActiveTab(field === 'subjects' ? 'academics' : 'personal')
        window.setTimeout(() => {
          if (field === 'subjects') document.getElementById('profile-subjects')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          else if (field === 'photo_url') document.getElementById('profile-photo-upload')?.focus()
          else document.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()
        }, 100)
      }} />
      {role === 'student' && (
        <section className="px-5 py-4 sm:px-7" aria-label="Profile completion" aria-live="polite">
          {profileComplete ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Profile complete</p>
              <Button variant="ghost" size="sm" asChild><Link to="/dashboard">Go to dashboard <ArrowRight /></Link></Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-sm font-semibold">Complete your profile to access the dashboard</h2>
              </div>
              <ul className="mt-2 divide-y divide-border/60">
                {needsPhoto && (
                  <li className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-destructive">Profile photo required</span>
                    <Button type="button" variant="ghost" size="sm" onClick={goToPhotoUpload}>Upload photo <ArrowRight /></Button>
                  </li>
                )}
                {needsSubjects && (
                  <li className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-destructive">Subject choices required</span>
                    <Button type="button" variant="ghost" size="sm" onClick={goToSubjects}>Choose subjects <ArrowRight /></Button>
                  </li>
                )}
                {missingContactField && <li className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-destructive">Student phone and both addresses are required</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => {
                    setActiveTab('personal')
                    window.setTimeout(() => {
                      const field = document.querySelector<HTMLElement>(`[name="${missingContactField}"]`)
                      field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                      field?.focus({ preventScroll: true })
                    }, 100)
                  }}>Add details <ArrowRight /></Button>
                </li>}
                {!isValidBangladeshMobile(student?.guardian_phone) && (
                  <li className="py-3 text-sm text-destructive">Ask an administrator to add a valid guardian phone number.</li>
                )}
              </ul>
            </>
          )}
        </section>
      )}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <header className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-7 sm:py-6">
          <Avatar className="h-16 w-16 border-2 border-background shadow-sm sm:h-20 sm:w-20">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName + "'s profile"} />}
            <AvatarFallback className="bg-muted text-xl font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{displayName}</h1>
              {role && (
                <Badge className={'text-[11px] capitalize ' + (roleColors[role] ?? '')}>
                  {role === 'sub_admin' ? getSubAdminLabel(profile?.sub_admin_label) : role}
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{user?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Joined - {formatDisplayDate(profile.created_at)}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Active
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                {user?.last_sign_in_at ? 'Last sign in ' + formatDisplayDateTime(user.last_sign_in_at) : 'Last sign in unavailable'}
              </span>
            </div>
          </div>
        </header>

        <div className="px-3 pb-3 sm:px-7 sm:pb-4">
          <TabsList className={`grid h-auto! w-full gap-0.5 rounded-none bg-muted p-0.5 sm:gap-1 sm:p-1 ${role === 'student' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <TabsTrigger value="personal" className={profileTabClassName}>Personal</TabsTrigger>
            {role === 'student' && (
              <>
                <TabsTrigger value="academics" className={profileTabClassName}>Academics</TabsTrigger>
              </>
            )}
            <TabsTrigger value="security" className={profileTabClassName}>Security</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="personal" forceMount className="m-0 data-[state=inactive]:hidden">
          <form onSubmit={event => { event.preventDefault(); void personalAutosave.flush() }} onBlur={() => void personalAutosave.flush()} onChange={event => {
            if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) return
            const input = event.target
            if (Object.hasOwn(profileSchema.shape, input.name)) queuePersonalField(input.name as keyof ProfileForm, input.value)
          }}>
            <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <section className="p-5 sm:p-7 lg:border-r">
                <div className="mb-6">
                  <h2 className="text-base font-semibold">Personal information</h2>
                  <div className="mt-1"><AutosaveStatus {...personalAutosave} invalid={Object.keys(profileDirtyFields).length > 0 && Object.keys(profileErrors).length > 0} /></div>
                </div>
                <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Full name</Label>
                    </div>
                    <Input {...regProfile('full_name')} autoComplete="name" aria-invalid={!!profileErrors.full_name} />
                    {profileErrors.full_name && <p className="text-xs text-destructive">{profileErrors.full_name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Father's name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input {...regProfile('father_name')} aria-invalid={!!profileErrors.father_name} />
                    {profileErrors.father_name && <p className="text-xs text-destructive">{profileErrors.father_name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Mother's name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input {...regProfile('mother_name')} aria-invalid={!!profileErrors.mother_name} />
                    {profileErrors.mother_name && <p className="text-xs text-destructive">{profileErrors.mother_name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Blood group <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Select
                      value={bloodGroup || 'not-specified'}
                      onValueChange={value => {
                        const group = value === 'not-specified' ? '' : value as ProfileForm['blood_group']
                        setProfileValue('blood_group', group, { shouldValidate: true, shouldDirty: true })
                        queuePersonalField('blood_group', group)
                        void personalAutosave.flush()
                      }}
                    >
                      <SelectTrigger aria-invalid={!!profileErrors.blood_group}><SelectValue placeholder="Select blood group" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not-specified">Not specified</SelectItem>
                        {BLOOD_GROUPS.map(group => <SelectItem key={group} value={group}>{group}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {profileErrors.blood_group && <p className="text-xs text-destructive">{profileErrors.blood_group.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>{role === 'student' ? 'Guardian phone' : 'Phone'}</Label>
                      {role === 'student' && <span className="text-xs text-muted-foreground">Managed by admin</span>}
                    </div>
                    <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" readOnly={phoneManagedByAdmin} className={phoneManagedByAdmin ? 'bg-muted/40 opacity-50 cursor-not-allowed' : undefined} {...regProfile('phone')} aria-invalid={!!profileErrors.phone} />
                    {profileErrors.phone && <p className="text-xs text-destructive">{profileErrors.phone.message}</p>}
                    {!phoneManagedByAdmin && parentPhone && !profileErrors.phone && parentPhoneIsValid && (
                      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Valid Bangladesh mobile number</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Secondary mobile number <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" {...regProfile('secondary_phone')} aria-invalid={!!profileErrors.secondary_phone} />
                    {profileErrors.secondary_phone && <p className="text-xs text-destructive">{profileErrors.secondary_phone.message}</p>}
                    {secondaryPhone && !profileErrors.secondary_phone && (
                      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Valid Bangladesh mobile number</p>
                    )}
                  </div>
                  {role === 'student' && <>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="student-phone" className={!isValidBangladeshMobile(student?.student_phone) ? 'text-destructive' : undefined}>Student phone <span className="font-normal">(required)</span></Label>
                      <Input id="student-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" {...regProfile('student_phone')} required aria-invalid={!!profileErrors.student_phone} />
                      {profileErrors.student_phone && <p className="text-xs text-destructive">{profileErrors.student_phone.message}</p>}
                    </div>
                    {(['present_address', 'permanent_address'] as const).map(field => <div key={field} className="space-y-2 sm:col-span-2">
                      <Label htmlFor={field} className={!student?.[field]?.trim() ? 'text-destructive' : undefined}>{field === 'present_address' ? 'Present address' : 'Permanent address'} <span className="font-normal">(required)</span></Label>
                      <Textarea id={field} rows={2} maxLength={1000} autoComplete={field === 'present_address' ? 'section-present street-address' : 'section-permanent street-address'} placeholder="House, road or village, area, district and postcode" {...regProfile(field)} required aria-invalid={!!profileErrors[field]} />
                      {profileErrors[field] && <p className="text-xs text-destructive">{profileErrors[field]?.message}</p>}
                    </div>)}
                  </>}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Email</Label>
                    <Input value={user?.email ?? ''} disabled className="bg-muted/40" />
                  </div>
                </div>
              </section>

              <section className="border-t p-5 sm:p-7 lg:border-t-0">
                <div className="mb-6">
                  <h2 className="text-base font-semibold">Documents & photo</h2>
                  <p className={`mt-1 text-sm ${needsPhoto ? 'text-destructive' : 'text-muted-foreground'}`}>{role === 'student' ? 'Uploading photo is compulsory.' : 'Optional files linked to your profile.'}</p>
                </div>
                {user && <ProfileUploads profile={profile} student={role === 'student' ? student ?? undefined : undefined} userId={user.id} refreshProfile={refreshProfile} stacked />}
              </section>
            </div>
          </form>
        </TabsContent>

        {role === 'student' && student && (
          <TabsContent value="academics" forceMount className="m-0 data-[state=inactive]:hidden">
            <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div className="p-5 sm:p-7 lg:border-r [&_section]:border-0 [&_section]:pt-0">
                <StudentSubjects student={student} />
              </div>
              <section className="border-t p-5 sm:p-7 lg:border-t-0">
                <div className="mb-5">
                  <h2 className="text-base font-semibold">Academic history</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Classes and academic sessions.</p>
                </div>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading history...</div>
                ) : enrollmentHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No academic history is available yet.</p>
                ) : (
                  <div className="divide-y">
                    {enrollmentHistory.map(enrollment => (
                      <div key={enrollment.id} className="py-4 first:pt-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{enrollment.classes.name} ({enrollment.classes.grade}-{enrollment.classes.section})</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{enrollment.academic_years.name}</p>
                          </div>
                          <Badge variant={enrollment.ended_on ? 'secondary' : 'default'} className="capitalize">{enrollment.status}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{formatDisplayDate(enrollment.started_on)} – {enrollment.ended_on ? formatDisplayDate(enrollment.ended_on) : 'Current'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </TabsContent>
        )}

        <TabsContent value="security" className="m-0">
          <section className="max-w-2xl p-5 sm:p-7">
            <div className="mb-6">
              <h2 className="text-base font-semibold">Password & security</h2>
              <p className="mt-1 text-sm text-muted-foreground">{passwordLocked ? 'Password changes are disabled for this shared login.' : 'Use a strong password you do not use elsewhere.'}</p>
            </div>
            {passwordLocked ? <p className="text-sm text-muted-foreground">This is an open account. Password changes are managed by an administrator.</p> : <form onSubmit={handlePwd(changePassword)} className="space-y-5">
              <div className="space-y-2">
                <Label>Current password</Label>
                <div className="relative">
                  <Input type={visiblePasswords.old ? 'text' : 'password'} className="pr-10" autoComplete="current-password" {...regPwd('oldPassword')} aria-invalid={!!pwdErrors.oldPassword} />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full w-10 text-muted-foreground" onClick={() => togglePasswordVisibility('old')} aria-label={visiblePasswords.old ? 'Hide current password' : 'Show current password'}>
                    {visiblePasswords.old ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {pwdErrors.oldPassword && <p className="text-xs text-destructive">{pwdErrors.oldPassword.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>New password</Label>
                <div className="relative">
                  <Input type={visiblePasswords.new ? 'text' : 'password'} className="pr-10" autoComplete="new-password" {...regPwd('newPassword')} aria-invalid={!!pwdErrors.newPassword} />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full w-10 text-muted-foreground" onClick={() => togglePasswordVisibility('new')} aria-label={visiblePasswords.new ? 'Hide new password' : 'Show new password'}>
                    {visiblePasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {pwdErrors.newPassword && <p className="text-xs text-destructive">{pwdErrors.newPassword.message}</p>}
                {newPassword && (
                  <div className="space-y-3 rounded-lg bg-muted/35 p-4" aria-live="polite">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Password strength</span>
                      <span className={'font-medium ' + passwordStrength.text}>{passwordStrength.label}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={'h-full rounded-full transition-all ' + passwordStrength.color} style={{ width: String((metRequirements / passwordRequirements.length) * 100) + '%' }} />
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {passwordRequirements.map(requirement => {
                        const met = requirement.test(newPassword)
                        const RequirementIcon = met ? Check : Circle
                        return (
                          <div key={requirement.label} className={'flex items-center gap-1.5 text-xs ' + (met ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                            <RequirementIcon className="h-3.5 w-3.5 shrink-0" /><span>{requirement.label}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Confirm new password</Label>
                <div className="relative">
                  <Input type={visiblePasswords.confirm ? 'text' : 'password'} className="pr-10" autoComplete="new-password" {...regPwd('confirmPassword')} aria-invalid={!!pwdErrors.confirmPassword || (confirmPassword.length > 0 && !passwordsMatch)} />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full w-10 text-muted-foreground" onClick={() => togglePasswordVisibility('confirm')} aria-label={visiblePasswords.confirm ? 'Hide confirmation password' : 'Show confirmation password'}>
                    {visiblePasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {confirmPassword && (
                  <p className={'flex items-center gap-1.5 text-xs ' + (passwordsMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')} aria-live="polite">
                    {passwordsMatch ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {passwordsMatch ? 'Passwords match' : 'Passwords do not match yet'}
                  </p>
                )}
                {pwdErrors.confirmPassword && <p className="text-xs text-destructive">{pwdErrors.confirmPassword.message}</p>}
              </div>
              {AUTH_CAPTCHA_ENABLED && (turnstileSiteKey ? (
                <div className="flex justify-start py-1">
                  <Turnstile
                    ref={passwordTurnstileRef}
                    siteKey={turnstileSiteKey}
                    options={{ action: 'change_password', appearance: 'interaction-only', refreshExpired: 'manual', refreshTimeout: 'manual', size: 'flexible', theme: 'auto' }}
                    onSuccess={() => {
                      passwordTurnstileFailedRef.current = false
                      passwordTurnstileResetAttemptedRef.current = false
                    }}
                    onExpire={() => passwordTurnstileRef.current?.reset()}
                    onTimeout={handlePasswordTurnstileFailure}
                    onUnsupported={handlePasswordTurnstileFailure}
                    onError={handlePasswordTurnstileFailure}
                    scriptOptions={{ onError: handlePasswordTurnstileFailure }}
                  />
                </div>
              ) : (
                <p className="text-xs text-destructive">Security verification is not configured.</p>
              ))}
              <Button type="submit" disabled={changingPwd}>
                {changingPwd && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update password
              </Button>
            </form>}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
