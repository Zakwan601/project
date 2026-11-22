import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const classes = [{ id: 'business', name: 'Class 11 - Business' }, { id: 'science', name: 'Class 12 - Science' }]
const sessions = [{ id: 'science-session', class_id: 'science', classes: classes[1] }, { id: 'business-session', class_id: 'business', classes: classes[0] }]
let state, cursor, effects, params, lastClassFilter
const fakeReact = { ...React, useState(initial) {
  const index = cursor++
  if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
  return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
}, useEffect(effect) { effects.push(effect) } }
const ui = new Proxy({}, { get: (_, name) => {
  const component = () => null
  Object.defineProperty(component, 'name', { value: name })
  return component
} })
const mutation = () => ({ isPending: false, reset() {} })
const code = ts.transpileModule(readFileSync(new URL('../src/features/attendance/AttendancePage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const context = { exports: {}, URLSearchParams, window: { setInterval() {}, clearInterval() {} }, require(name) {
  if (name === 'react') return fakeReact
  if (name === 'react-router-dom') return { useSearchParams: () => [params, update => { params = update(params) }] }
  if (name === '@/contexts/AuthContext') return { useAuth: () => ({ can: () => false, profile: {} }) }
  if (name === '@/hooks/useClasses') return { useClasses: () => ({ data: classes, isLoading: false }) }
  if (name === '@/hooks/useAttendance') return { useAttendanceSessions: classId => {
    lastClassFilter = classId
    return { data: sessions.filter(row => !classId || row.class_id === classId), isLoading: false }
  }, useSyncDailyAttendance: mutation }
  if (name === '@/hooks/useHolidays') return { useHolidays: () => ({ data: [] }), useDeleteHoliday: mutation }
  if (name === '@/hooks/useAbsenceNotifications') return { useAbsenceNotificationStatus: () => ({ data: { hasSentMessage: true } }), useSendAbsenceNotifications: mutation }
  if (name === 'framer-motion') return { motion: ui }
  if (name.startsWith('@/')) return ui
  return require(name)
} }
vm.runInNewContext(code + '\nexports.staff = StaffDailyAttendance;', context)
function render() {
  cursor = 0; effects = []
  return context.exports.staff()
}
function nodes(tree, result = []) {
  if (Array.isArray(tree)) tree.forEach(child => nodes(child, result))
  else if (tree && typeof tree === 'object') { result.push(tree); nodes(tree.props?.children, result) }
  return result
}
function start(query = '') {
  state = []; params = new URLSearchParams(`date=2026-11-22&${query}`)
  render(); effects.forEach(effect => effect())
  return nodes(render())
}
let tree = start()
assert.equal(lastClassFilter, 'science', 'Initial class matches the attendance previously displayed first')
assert.equal(params.get('class_id'), 'science')
assert.ok(tree.some(node => node.props?.value === 'science' && node.props.onValueChange), 'Dropdown reflects the displayed class')
assert.ok(!tree.some(node => node.props?.['aria-label'] === 'Attendance classes'), 'Duplicate class sidebar is removed')
assert.ok(!tree.some(node => node.props?.children === 'All Classes'), 'All Classes is not an available choice')
tree.find(node => node.props?.value === 'science' && node.props.onValueChange).props.onValueChange('business')
tree = nodes(render())
assert.equal(lastClassFilter, 'business', 'Changing the dropdown scopes the attendance query')
assert.equal(tree.find(node => node.type?.name === 'DailyAttendanceSheet').props.session.id, 'business-session')
assert.equal(params.get('class_id'), 'business')
start('class_id=business&status=absent')
assert.equal(lastClassFilter, 'business', 'Class links keep their requested selection')
assert.equal(params.get('status'), 'absent', 'Class selection preserves other URL filters')
start('class_id=all')
assert.equal(lastClassFilter, 'science', 'Legacy All Classes URLs resolve to a real class')
start('class_id=unavailable')
assert.equal(lastClassFilter, 'business', 'Unavailable classes fall back to an accessible class')
console.log('Passed initial class selection, synchronized dropdown and attendance, class switching, class links and legacy URL fallback.')
