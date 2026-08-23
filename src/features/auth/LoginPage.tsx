import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { Eye, EyeOff, GraduationCap, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type LoginForm = z.infer<typeof loginSchema>

const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || undefined
const TURNSTILE_WAIT_TIMEOUT = 30_000

type LoginPhase = 'idle' | 'verifying' | 'signing-in'

interface TokenWaiter {
  resolve: (token: string) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

function isTurnstileAuthError(error: Error) {
  const status = 'status' in error ? Number(error.status) : 0
  const code = 'code' in error ? String(error.code) : ''
  const message = error.message.toLowerCase()
  return status === 403
    || code === 'captcha_failed'
    || message.includes('captcha')
    || message.includes('turnstile')
    || message.includes('security verification')
}

function loginErrorMessage(error: Error) {
  const status = 'status' in error ? Number(error.status) : 0
  const code = 'code' in error ? String(error.code) : ''
  if (isTurnstileAuthError(error)) return 'Security verification failed. Please try again.'
  if (code === 'profile_load_failed') return 'Signed in, but your profile could not be loaded. Please try again.'
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.'
  if (/network|fetch|connection|timeout/i.test(error.message)) {
    return 'Unable to reach the sign-in service. Check your connection and try again.'
  }
  return 'Unable to sign in. Check your credentials and try again.'
}

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle')
  const turnstileRef = useRef<TurnstileInstance>(null)
  const turnstileTokenRef = useRef<string | null>(null)
  const widgetReadyRef = useRef(false)
  const widgetFailedRef = useRef(false)
  const tokenWaitersRef = useRef(new Set<TokenWaiter>())
  const loginAttemptRef = useRef(0)
  const loginPhaseRef = useRef<LoginPhase>('idle')

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const updateLoginPhase = useCallback((phase: LoginPhase) => {
    loginPhaseRef.current = phase
    setLoginPhase(phase)
  }, [])

  const rejectTokenWaiters = useCallback((reason: Error) => {
    for (const waiter of tokenWaitersRef.current) {
      clearTimeout(waiter.timeoutId)
      waiter.reject(reason)
    }
    tokenWaitersRef.current.clear()
  }, [])

  const resolveTokenWaiters = useCallback((token: string) => {
    for (const waiter of tokenWaitersRef.current) {
      clearTimeout(waiter.timeoutId)
      waiter.resolve(token)
    }
    tokenWaitersRef.current.clear()
  }, [])

  const resetTurnstile = useCallback(() => {
    turnstileTokenRef.current = null
    widgetFailedRef.current = false
    turnstileRef.current?.reset()
  }, [])

  const handleTurnstileFailure = useCallback(() => {
    turnstileTokenRef.current = null
    widgetFailedRef.current = true
    rejectTokenWaiters(new Error('Security verification failed'))

    // Background expiry/timeouts are recoverable and should not alarm the user.
    // During a login, the submit flow resets and retries with a fresh token.
    if (loginPhaseRef.current === 'idle') {
      window.setTimeout(() => resetTurnstile(), 0)
    }
  }, [rejectTokenWaiters, resetTurnstile])

  const waitForTurnstileToken = useCallback(() => {
    if (!turnstileSiteKey) {
      return Promise.reject(new Error('Security verification is not configured'))
    }

    const widget = turnstileRef.current
    if (widgetReadyRef.current && widget?.isExpired()) {
      resetTurnstile()
    }

    const existingToken = turnstileTokenRef.current
      || (widgetReadyRef.current ? widget?.getResponse() : undefined)
    if (existingToken) return Promise.resolve(existingToken)

    if (widgetFailedRef.current) resetTurnstile()

    return new Promise<string>((resolve, reject) => {
      const waiter: TokenWaiter = {
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          tokenWaitersRef.current.delete(waiter)
          reject(new Error('Security verification timed out'))
        }, TURNSTILE_WAIT_TIMEOUT),
      }
      tokenWaitersRef.current.add(waiter)
    })
  }, [resetTurnstile])

  useEffect(() => () => {
    loginAttemptRef.current += 1
    rejectTokenWaiters(new Error('Login page closed'))
  }, [rejectTokenWaiters])

  const onSubmit = async (data: LoginForm) => {
    if (loginPhaseRef.current !== 'idle') return

    const attemptId = ++loginAttemptRef.current
    setError('')
    if (!turnstileSiteKey) {
      setError('Security verification is not configured. Contact the administrator.')
      return
    }

    try {
      for (let verificationAttempt = 0; verificationAttempt < 2; verificationAttempt += 1) {
        updateLoginPhase('verifying')

        let token: string
        try {
          token = await waitForTurnstileToken()
        } catch (verificationError) {
          if (attemptId !== loginAttemptRef.current) return
          resetTurnstile()
          if (verificationAttempt === 0) continue
          throw verificationError
        }

        if (attemptId !== loginAttemptRef.current) return
        updateLoginPhase('signing-in')
        const { error: signInError } = await signIn(data.email, data.password, token)
        if (attemptId !== loginAttemptRef.current) return

        // Turnstile tokens are single-use, including rejected authentication requests.
        resetTurnstile()
        if (!signInError) {
          navigate('/dashboard')
          return
        }

        if (isTurnstileAuthError(signInError) && verificationAttempt === 0) {
          continue
        }

        setError(loginErrorMessage(signInError))
        return
      }

      setError('Security verification failed. Please try again.')
    } catch (submissionError) {
      if (attemptId !== loginAttemptRef.current) return
      resetTurnstile()
      setError(submissionError instanceof Error && submissionError.message.includes('not configured')
        ? 'Security verification is not configured. Contact the administrator.'
        : 'Security verification failed. Please try again.')
    } finally {
      if (attemptId === loginAttemptRef.current) updateLoginPhase('idle')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <GraduationCap className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">Axentra@Zuanshi</p>
              <p className="text-xs text-muted-foreground">School Attendance System</p>
            </div>
          </div>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@school.edu"
                  autoComplete="email"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register('password')}
                    aria-invalid={!!errors.password}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPwd(v => !v)}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>
              {turnstileSiteKey ? (
                <div className="flex justify-center rounded-md border bg-background p-2">
                  <Turnstile
                    ref={turnstileRef}
                    siteKey={turnstileSiteKey}
                    options={{
                      action: 'login',
                      appearance: 'interaction-only',
                      refreshExpired: 'auto',
                      refreshTimeout: 'auto',
                      size: 'flexible',
                      theme: 'auto',
                    }}
                    onLoadScript={() => {
                      widgetFailedRef.current = false
                    }}
                    onWidgetLoad={() => {
                      widgetReadyRef.current = true
                      widgetFailedRef.current = false
                    }}
                    onSuccess={token => {
                      turnstileTokenRef.current = token
                      widgetFailedRef.current = false
                      resolveTokenWaiters(token)
                    }}
                    onExpire={() => {
                      turnstileTokenRef.current = null
                      widgetFailedRef.current = false
                    }}
                    onTimeout={handleTurnstileFailure}
                    onUnsupported={handleTurnstileFailure}
                    onError={handleTurnstileFailure}
                    scriptOptions={{ onError: handleTurnstileFailure }}
                  />
                </div>
              ) : (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Security verification is not configured. Add the Turnstile site key before deploying.
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loginPhase !== 'idle'}>
                {loginPhase !== 'idle' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loginPhase === 'verifying' ? 'Verifying...' : loginPhase === 'signing-in' ? 'Signing in...' : 'Sign In'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Contact your administrator for account credentials.
              </p>
            </CardFooter>
          </form>
        </Card>
      </motion.div>
    </div>
  )
}
