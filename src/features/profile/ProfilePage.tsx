import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Check, Circle, Clock3, Eye, EyeOff, Loader2, Save, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { isProfileComplete, isValidBangladeshMobile, normalizeBangladeshMobile } from '@/lib/profile'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Required'),
  phone: z.string()
    .trim()
    .min(1, "Parent's phone is required")
    .refine(isValidBangladeshMobile, 'Enter a valid Bangladesh mobile number'),
  address: z.string().trim().min(1, 'Address is required'),
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
  const { profile, student, user, refreshProfile, role } = useAuth()
  const [saving, setSaving] = useState(false)
  const [changingPwd, setChangingPwd] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState({ old: false, new: false, confirm: false })
  const phoneManagedByAdmin = role === 'student'

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
      full_name: profile?.full_name ?? '',
      phone: role === 'student' ? student?.guardian_phone ?? '' : profile?.phone ?? '',
      address: role === 'student' ? student?.address ?? '' : profile?.address ?? '',
    },
  })

  useEffect(() => {
    resetProfile({
      full_name: profile?.full_name ?? '',
      phone: role === 'student' ? student?.guardian_phone ?? '' : profile?.phone ?? '',
      address: role === 'student' ? student?.address ?? '' : profile?.address ?? '',
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

  const saveProfile = async (data: ProfileForm) => {
    setSaving(true)
    try {
      if (!profile) throw new Error('Your profile record could not be found. Please contact an administrator.')

      const updates = role === 'student'
        ? { full_name: data.full_name.trim() }
        : {
            full_name: data.full_name.trim(),
            phone: normalizeBangladeshMobile(data.phone),
            address: data.address.trim(),
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
    try {
      // Verify old password by re-authenticating
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: data.oldPassword,
      })
      if (verifyErr) {
        toast.error('Current password is incorrect')
        setChangingPwd(false)
        return
      }

      // Update to new password
      const { error } = await supabase.auth.updateUser({ password: data.newPassword })
      if (error) throw error
      toast.success('Password changed successfully')
      resetPwd()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChangingPwd(false)
    }
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const roleColors: Record<string, string> = {
    admin: 'bg-destructive text-destructive-foreground',
    student: 'bg-secondary text-secondary-foreground',
  }

  return (
    <div className="max-w-2xl space-y-3 sm:space-y-6">
      <PageHeader title="Profile" description="Manage your personal information and security" />

      {!isProfileComplete(profile, student) && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Wait for Admin to complete your profile</p>
            <p className="text-xs opacity-80">
              {role === 'student'
                ? "Ask an administrator to add a valid guardian phone number and address to your student record."
                : 'Add a valid Bangladesh mobile number and your address.'}
            </p>
          </div>
        </div>
      )}

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 sm:gap-4">
            <Avatar className="h-12 w-12 sm:h-16 sm:w-16">
              <AvatarFallback className="text-xl bg-muted">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{profile?.full_name}</CardTitle>
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
                <Badge className={`mt-2 text-xs capitalize ${roleColors[role] ?? ''}`}>{role}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-3 sm:pt-6">
          <form onSubmit={handleProfile(saveProfile)} className="space-y-3 sm:space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input {...regProfile('full_name')} aria-invalid={!!profileErrors.full_name} />
              {profileErrors.full_name && <p className="text-xs text-destructive">{profileErrors.full_name.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{role === 'student' ? "Parent's Phone" : 'Phone'}</Label>
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
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                  <Label>Address</Label>
                  {role === 'student' && <Badge variant="outline">Managed by admin</Badge>}
                </div>
              <Input
                {...regProfile('address')}
                readOnly={phoneManagedByAdmin}
                className={phoneManagedByAdmin ? 'bg-muted' : undefined}
                aria-invalid={!!profileErrors.address}
              />
              {profileErrors.address && <p className="text-xs text-destructive">{profileErrors.address.message}</p>}
              {phoneManagedByAdmin && <p className="text-xs text-muted-foreground">This address is maintained in the admin panel.</p>}
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

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
