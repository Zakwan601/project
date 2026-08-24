import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Circle, Clock3, Eye, EyeOff, Loader2, Save, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import { isValidBangladeshMobile, normalizeBangladeshMobile } from '@/lib/profile'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import { toast } from 'sonner'
import { LoadingState, PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useStudentEnrollmentHistory } from '@/hooks/useStudents'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || undefined

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Required'),
  phone: z.string()
    .trim()
    .min(1, 'Phone is required')
    .refine(isValidBangladeshMobile, 'Enter a valid Bangladesh mobile number'),
})
type ProfileForm = z.infer<typeof profileSchema>

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
  const { profile, student, user, refreshProfile, role, loading, profileError } = useAuth()
  const [saving, setSaving] = useState(false)
  const [changingPwd, setChangingPwd] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState({ old: false, new: false, confirm: false })
  const passwordTurnstileRef = useRef<TurnstileInstance>(null)
  const passwordTurnstileRejectRef = useRef<((error: Error) => void) | null>(null)
  const passwordTurnstileFailedRef = useRef(false)
  const passwordTurnstileResetAttemptedRef = useRef(false)
  const phoneManagedByAdmin = role === 'student'
  const { data: enrollmentHistory = [], isLoading: historyLoading } = useStudentEnrollmentHistory(
    role === 'student' ? student?.id : undefined,
  )

  const {
    register: regProfile,
    handleSubmit: handleProfile,
    reset: resetProfile,
    watch: watchProfile,
    formState: { errors: profileErrors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    mode: 'onChange',
    defaultValues: {
      full_name: role === 'student' && student
        ? `${student.first_name} ${student.last_name}`.trim()
        : profile?.full_name ?? '',
      phone: role === 'student' ? student?.guardian_phone ?? '' : profile?.phone ?? '',
    },
  })

  useEffect(() => {
    resetProfile({
      full_name: role === 'student' && student
        ? `${student.first_name} ${student.last_name}`.trim()
        : profile?.full_name ?? '',
      phone: role === 'student' ? student?.guardian_phone ?? '' : profile?.phone ?? '',
    })
  }, [profile, resetProfile, role, student])

  const { register: regPwd, handleSubmit: handlePwd, reset: resetPwd, watch: watchPwd, formState: { errors: pwdErrors } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
  })

  const newPassword = watchPwd('newPassword')
  const confirmPassword = watchPwd('confirmPassword')
  const parentPhone = watchProfile('phone')
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

  const saveProfile = async (data: ProfileForm) => {
    setSaving(true)
    try {
      if (!profile) throw new Error('Your profile record could not be found. Please contact an administrator.')

      const updates = role === 'student'
        ? { full_name: data.full_name.trim() }
        : {
            full_name: data.full_name.trim(),
            phone: normalizeBangladeshMobile(data.phone),
          }

      const { error } = await db
        .from('profiles')
        .update(updates)
        .eq('id', profile.id)
      if (error) throw error
      await refreshProfile()
      toast.success('Profile updated')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async (data: PasswordForm) => {
    setChangingPwd(true)
    passwordTurnstileResetAttemptedRef.current = false
    try {
      // Verify old password by re-authenticating
      const captchaToken = await getPasswordTurnstileToken()
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: data.oldPassword,
        options: { captchaToken },
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
      <div className="max-w-2xl space-y-3 sm:space-y-6">
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
      <div className="max-w-2xl space-y-3 sm:space-y-6">
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
    <div className="max-w-2xl space-y-3 sm:space-y-6">
      <PageHeader title="Profile" description="Manage your personal information and security" />

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 sm:gap-4">
            <Avatar className="h-12 w-12 sm:h-16 sm:w-16">
              <AvatarFallback className="text-xl bg-muted">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{displayName}</CardTitle>
              <CardDescription>{user?.email}</CardDescription>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Last sign in:{' '}
                  {user?.last_sign_in_at
                    ? formatDisplayDateTime(user.last_sign_in_at)
                    : 'Not available'}
                </span>
              </p>
              {role && (
                <Badge className={`mt-2 text-xs capitalize ${roleColors[role] ?? ''}`}>
                  {role === 'sub_admin' ? 'Sub-admin' : role}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-3 sm:pt-6">
          <form onSubmit={handleProfile(saveProfile)} className="space-y-3 sm:space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                {...regProfile('full_name')}
                readOnly={role === 'student'}
                className={role === 'student' ? 'bg-muted' : undefined}
                aria-invalid={!!profileErrors.full_name}
              />
              {profileErrors.full_name && <p className="text-xs text-destructive">{profileErrors.full_name.message}</p>}
              {role === 'student' && <p className="text-xs text-muted-foreground">This name is maintained in the admin panel.</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{role === 'student' ? 'Guardian Phone' : 'Phone'}</Label>
                  {role === 'student' && <Badge variant="outline">Managed by admin</Badge>}
                </div>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01XXXXXXXXX"
                  readOnly={phoneManagedByAdmin}
                  className={phoneManagedByAdmin ? 'bg-muted' : undefined}
                  {...regProfile('phone')}
                  aria-invalid={!!profileErrors.phone}
                />
                {profileErrors.phone && <p className="text-xs text-destructive">{profileErrors.phone.message}</p>}
                {!phoneManagedByAdmin && parentPhone && !profileErrors.phone && parentPhoneIsValid && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" /> Valid Bangladesh mobile number
                  </p>
                )}
                {phoneManagedByAdmin && <p className="text-xs text-muted-foreground">This is the guardian phone maintained in the admin panel.</p>}
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={user?.email ?? ''} disabled />
              </div>
            </div>
            {role !== 'student' && <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>}
          </form>
        </CardContent>
      </Card>

      {role === 'student' && (
        <Card>
          <CardHeader>
            <CardTitle>Academic History</CardTitle>
            <CardDescription>Your class assignments by academic year</CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading history...
              </div>
            ) : enrollmentHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No academic history is available yet.</p>
            ) : (
              <div className="space-y-2">
                {enrollmentHistory.map(enrollment => (
                  <div key={enrollment.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {enrollment.classes.name} ({enrollment.classes.grade}-{enrollment.classes.section})
                      </p>
                      <p className="text-xs text-muted-foreground">{enrollment.academic_years.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDisplayDate(enrollment.started_on)} – {enrollment.ended_on ? formatDisplayDate(enrollment.ended_on) : 'Current'}
                      </p>
                    </div>
                    <Badge variant={enrollment.ended_on ? 'secondary' : 'default'} className="capitalize">
                      {enrollment.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePwd(changePassword)} className="space-y-3 sm:space-y-4">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <div className="relative">
                <Input
                  type={visiblePasswords.old ? 'text' : 'password'}
                  className="pr-10"
                  autoComplete="current-password"
                  {...regPwd('oldPassword')}
                  aria-invalid={!!pwdErrors.oldPassword}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-10 text-muted-foreground"
                  onClick={() => togglePasswordVisibility('old')}
                  aria-label={visiblePasswords.old ? 'Hide current password' : 'Show current password'}
                >
                  {visiblePasswords.old ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {pwdErrors.oldPassword && <p className="text-xs text-destructive">{pwdErrors.oldPassword.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <div className="relative">
                <Input
                  type={visiblePasswords.new ? 'text' : 'password'}
                  className="pr-10"
                  autoComplete="new-password"
                  {...regPwd('newPassword')}
                  aria-invalid={!!pwdErrors.newPassword}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-10 text-muted-foreground"
                  onClick={() => togglePasswordVisibility('new')}
                  aria-label={visiblePasswords.new ? 'Hide new password' : 'Show new password'}
                >
                  {visiblePasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {pwdErrors.newPassword && <p className="text-xs text-destructive">{pwdErrors.newPassword.message}</p>}
              {newPassword && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3" aria-live="polite">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Password strength</span>
                    <span className={`font-medium ${passwordStrength.text}`}>{passwordStrength.label}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${passwordStrength.color}`}
                      style={{ width: `${(metRequirements / passwordRequirements.length) * 100}%` }}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {passwordRequirements.map(requirement => {
                      const met = requirement.test(newPassword)
                      const RequirementIcon = met ? Check : Circle
                      return (
                        <div
                          key={requirement.label}
                          className={`flex items-center gap-1.5 text-xs ${met ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
                        >
                          <RequirementIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>{requirement.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Avoid names, common phrases, and passwords used on other accounts.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Confirm New Password</Label>
              <div className="relative">
                <Input
                  type={visiblePasswords.confirm ? 'text' : 'password'}
                  className="pr-10"
                  autoComplete="new-password"
                  {...regPwd('confirmPassword')}
                  aria-invalid={!!pwdErrors.confirmPassword || (confirmPassword.length > 0 && !passwordsMatch)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-10 text-muted-foreground"
                  onClick={() => togglePasswordVisibility('confirm')}
                  aria-label={visiblePasswords.confirm ? 'Hide confirmation password' : 'Show confirmation password'}
                >
                  {visiblePasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {confirmPassword && (
                <p
                  className={`flex items-center gap-1.5 text-xs ${passwordsMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
                  aria-live="polite"
                >
                  {passwordsMatch ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  {passwordsMatch ? 'Passwords match' : 'Passwords do not match yet'}
                </p>
              )}
              {pwdErrors.confirmPassword && <p className="text-xs text-destructive">{pwdErrors.confirmPassword.message}</p>}
            </div>
            {turnstileSiteKey ? (
              <div className="flex justify-center rounded-md border bg-background p-2">
                <Turnstile
                  ref={passwordTurnstileRef}
                  siteKey={turnstileSiteKey}
                  options={{
                    action: 'change_password',
                    appearance: 'interaction-only',
                    refreshExpired: 'manual',
                    refreshTimeout: 'manual',
                    size: 'flexible',
                    theme: 'auto',
                  }}
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
            )}
            <Button type="submit" variant="outline" disabled={changingPwd}>
              {changingPwd && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
