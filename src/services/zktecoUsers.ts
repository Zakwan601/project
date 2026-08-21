import { studentsService } from '@/services/students'
import type { Student } from '@/types/database'

const ZKTECO_BASE_URL = 'https://zkteco.humayidstore.workers.dev'
const ZKTECO_DEVICE_SN = 'UDP3251601340'

interface ZktecoUser {
  PIN?: string | number | null
  Name?: string | null
  Card?: string | null
  Verify?: string | null
  detected_at?: string | null
  [key: string]: unknown
}

interface PendingUsersResponse {
  success: boolean
  count?: number
  users?: ZktecoUser[]
}

interface AcknowledgeResponse {
  success: boolean
  remaining?: number
  error?: string
}

export interface ZktecoSyncSummary {
  received: number
  created: number
  alreadyExisted: number
  failed: number
  acknowledged: number
  acknowledgementFailed: number
  remainingPending: number
  errors: string[]
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function requiredStudentName(name: string | null | undefined, nextMissingNumber: () => number) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)

  if (parts.length === 0) {
    const number = nextMissingNumber()
    return { firstName: 'Name', lastName: `Missed ${number}` }
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: `Name Missed ${nextMissingNumber()}`,
    }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function studentFromZktecoUser(
  user: ZktecoUser,
  pin: string,
  nextMissingNumber: () => number,
): Omit<Student, 'id' | 'created_at' | 'updated_at'> {
  const { firstName, lastName } = requiredStudentName(user.Name, nextMissingNumber)

  return {
    profile_id: null,
    admission_number: pin,
    class_id: null,
    roll_number: null,
    first_name: firstName,
    last_name: lastName,
    guardian_phone: null,
    date_of_admission: new Date().toISOString().slice(0, 10),
    biometric_id: pin,
    photo_url: null,
    is_active: true,
  }
}

async function fetchPendingUsers() {
  const url = new URL(`${ZKTECO_BASE_URL}/user-sync/new`)
  url.searchParams.set('SN', ZKTECO_DEVICE_SN)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ZKTeco users: ${response.status}`)
  }

  const data = await response.json() as PendingUsersResponse
  if (!data.success) {
    throw new Error('ZKTeco Worker returned an unsuccessful response')
  }

  return data
}

async function acknowledgeUser(pin: string) {
  const url = new URL(`${ZKTECO_BASE_URL}/user-sync/ack`)
  url.searchParams.set('SN', ZKTECO_DEVICE_SN)
  url.searchParams.set('PIN', pin)

  const response = await fetch(url, { method: 'POST' })
  const data = await response.json() as AcknowledgeResponse

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Acknowledgement failed with status ${response.status}`)
  }

  return data
}

export async function syncZktecoUsers(): Promise<ZktecoSyncSummary> {
  const pending = await fetchPendingUsers()
  const users = Array.isArray(pending.users) ? pending.users : []
  const received = typeof pending.count === 'number' ? pending.count : users.length
  let missingNameCount = 0
  let latestRemaining: number | null = null

  const summary: ZktecoSyncSummary = {
    received,
    created: 0,
    alreadyExisted: 0,
    failed: 0,
    acknowledged: 0,
    acknowledgementFailed: 0,
    remainingPending: received,
    errors: [],
  }

  const nextMissingNumber = () => {
    missingNameCount += 1
    return missingNameCount
  }

  for (const user of users) {
    const pin = String(user.PIN ?? '').trim()
    if (!pin) {
      summary.failed += 1
      summary.errors.push('Skipped a ZKTeco user because its PIN was missing.')
      console.error('Skipping ZKTeco user without PIN', user)
      continue
    }

    try {
      const existingStudent = await studentsService.getByZktecoPin(pin)

      if (existingStudent) {
        summary.alreadyExisted += 1
      } else {
        const student = studentFromZktecoUser(user, pin, nextMissingNumber)
        await studentsService.create(student)
        summary.created += 1
      }
    } catch (error) {
      summary.failed += 1
      summary.errors.push(`PIN ${pin}: ${errorMessage(error)}`)
      console.error(`Failed to synchronize ZKTeco PIN ${pin}`, error)
      continue
    }

    try {
      const acknowledgement = await acknowledgeUser(pin)
      summary.acknowledged += 1
      if (typeof acknowledgement.remaining === 'number') {
        latestRemaining = acknowledgement.remaining
      }
    } catch (error) {
      summary.acknowledgementFailed += 1
      summary.errors.push(`PIN ${pin} was saved but not acknowledged: ${errorMessage(error)}`)
      console.error(`ZKTeco PIN ${pin} was processed but acknowledgement failed`, error)
    }
  }

  summary.remainingPending = latestRemaining ?? Math.max(0, received - summary.acknowledged)
  return summary
}
