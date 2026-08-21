import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, Student, UserRole } from '@/types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  student: Student | null
  role: UserRole | null
  loading: boolean
  signIn: (email: string, password: string, captchaToken: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

interface ProfileLoad {
  userId: string
  promise: Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const [loading, setLoading] = useState(true)
  const profileLoadRef = useRef<ProfileLoad | null>(null)
  const loadedUserIdRef = useRef<string | null>(null)
  const activeUserIdRef = useRef<string | null>(null)

  const fetchProfile = useCallback((userId: string) => {
    const currentLoad = profileLoadRef.current
    if (currentLoad?.userId === userId) return currentLoad.promise

    const load: ProfileLoad = { userId, promise: Promise.resolve() }
    load.promise = (async () => {
      try {
        const [{ data: profileData, error: profileError }, { data: studentData, error: studentError }] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase.from('students').select('*').eq('profile_id', userId).maybeSingle(),
        ])
        if (profileError) throw profileError
        if (studentError) throw studentError
        if (profileLoadRef.current !== load) return
        setProfile(profileData)
        setStudent(studentData)
        loadedUserIdRef.current = userId
      } catch (error) {
        if (profileLoadRef.current === load) throw error
      } finally {
        if (profileLoadRef.current === load) profileLoadRef.current = null
      }
    })()
    profileLoadRef.current = load
    return load.promise
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id)
  }, [fetchProfile, user])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUser = nextSession?.user ?? null
      const nextUserId = nextUser?.id ?? null
      activeUserIdRef.current = nextUserId
      setSession(nextSession)
      setUser(nextUser)

      if (!nextUserId) {
        profileLoadRef.current = null
        loadedUserIdRef.current = null
        setProfile(null)
        setStudent(null)
        setLoading(false)
        return
      }

      const needsProfile = loadedUserIdRef.current !== nextUserId || event === 'USER_UPDATED'
      if (!needsProfile) {
        setLoading(false)
        return
      }

      setLoading(true)
      void fetchProfile(nextUserId)
        .catch(() => {
          if (activeUserIdRef.current === nextUserId) {
            setProfile(null)
            setStudent(null)
          }
        })
        .finally(() => {
          if (activeUserIdRef.current === nextUserId) setLoading(false)
        })
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  useEffect(() => {
    if (!user) return

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') {
        void fetchProfile(user.id).catch(() => undefined)
      }
    }

    window.addEventListener('focus', refreshWhenActive)
    document.addEventListener('visibilitychange', refreshWhenActive)

    return () => {
      window.removeEventListener('focus', refreshWhenActive)
      document.removeEventListener('visibilitychange', refreshWhenActive)
    }
  }, [fetchProfile, user])

  const signIn = async (email: string, password: string, captchaToken: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    })
    return { error: error as Error | null }
  }

  const signUp = async (email: string, password: string, fullName: string, role: UserRole) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      session, user, profile, student, role: profile?.role ?? null,
      loading, signIn, signUp, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
