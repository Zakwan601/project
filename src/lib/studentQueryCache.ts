export const STUDENTS_KEY = 'students'

// One server-authorized list per account/access scope, shared across screens.
export const studentListKey = (userId: string, accessScope: string) => [STUDENTS_KEY, 'list', userId, accessScope] as const
export const studentDetailKey = (userId: string, accessScope: string, studentId: string) => [STUDENTS_KEY, 'detail', userId, accessScope, studentId] as const
export const studentPeriodKey = (userId: string, accessScope: string, classId: string, startDate: string, endDate: string) =>
  [STUDENTS_KEY, 'period', userId, accessScope, classId, startDate, endDate] as const

export const studentCacheOptions = {
  staleTime: 10 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: true,
  refetchInterval: 10 * 60 * 1000,
  refetchIntervalInBackground: false,
} as const
