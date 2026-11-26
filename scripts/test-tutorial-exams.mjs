import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const modelSource=readFileSync(new URL('../src/features/results/result-model.ts',import.meta.url),'utf8')
const modelCode=ts.transpileModule(modelSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const { examSubjectConfigValues,validExamSubjectConfig,isTotalOnlyExam,isTotalPassExam,gradeSubject,subjectSectionsPassed }=await import(`data:text/javascript;base64,${Buffer.from(modelCode).toString('base64')}`)
const draft={selected:true,total:'20',creative:'',written:'',practical:'',pass:'',creativePass:'',writtenPass:'',practicalPass:''}
assert.equal(isTotalOnlyExam({result_exam_types:{name:'Custom title',marks_mode:'total_only'}}),true)
assert.equal(isTotalOnlyExam({result_exam_types:{name:'Tutorial exam',marks_mode:'sectioned'}}),false,'Behavior comes from type metadata, not a title string')
const tutorial=examSubjectConfigValues(draft,true)
assert.deepEqual(tutorial,[0,20,0,0,20,0,0,0])
assert.equal(validExamSubjectConfig(tutorial,true),true,'Only total maximum is required')
assert.equal(validExamSubjectConfig(examSubjectConfigValues({...draft,total:'0'},true),true),false)
assert.equal(validExamSubjectConfig(examSubjectConfigValues({...draft,total:'abc'},true),true),false)
assert.equal(validExamSubjectConfig(examSubjectConfigValues({...draft,total:'12.5'},true),true),true)
assert.equal(validExamSubjectConfig(examSubjectConfigValues(draft,false),false),false,'Regular exams still require section distribution and pass marks')
assert.equal(validExamSubjectConfig(examSubjectConfigValues({...draft,total:'100',creative:'70',written:'30',pass:'33',creativePass:'23',writtenPass:'10'},false),false),true)
const cqMcqDraft={...draft,creative:'10',written:'10',pass:'6.6'}
const cqMcq=examSubjectConfigValues(cqMcqDraft,false,true)
assert.deepEqual(cqMcq,[10,10,0,6.6,20,0,0,0])
assert.equal(isTotalPassExam({result_exam_types:{marks_mode:'total_pass'}}),true)
assert.equal(validExamSubjectConfig(cqMcq,false,true),true)
assert.equal(validExamSubjectConfig(cqMcq,false),false,'Regular exams still require individual section passing')
assert.equal(validExamSubjectConfig(examSubjectConfigValues({...cqMcqDraft,pass:'0'},false,true),false,true),false)
assert.equal(validExamSubjectConfig([10,10,0,6.6,20,1,0,0],false,true),false)
for (const [cq,mcq] of [[20,0],[0,20],[10,10]]) {
  const config=examSubjectConfigValues({...cqMcqDraft,creative:String(cq),written:String(mcq)},false,true)
  assert.equal(validExamSubjectConfig(config,false,true),true,`Tutorial CQ ${cq} / MCQ ${mcq} must be configurable`)
}
assert.equal(validExamSubjectConfig([0,0,0,0,0,0,0,0],false,true),false,'A subject still requires a positive total')
assert.equal(validExamSubjectConfig([-1,21,0,6.6,20,0,0,0],false,true),false,'Negative section maximums are rejected')
assert.equal(validExamSubjectConfig([20,0,0,21,20,0,0,0],false,true),false,'Passing cannot exceed the total')
const cqMcqSubject={creative_max:10,written_max:10,practical_max:0,creative_pass_mark:0,written_pass_mark:0,practical_pass_mark:0}
for(const [cq,mcq,passed] of [[0,6.6,true],[6.6,0,true],[3,3.6,true],[3,3.5,false],[0,0,false]]) {
  assert.equal(gradeSubject(cq+mcq,20,6.6,false,subjectSectionsPassed(cqMcqSubject,{creativeMarks:cq,writtenMarks:mcq,practicalMarks:0})).passed,passed)
}

// Render the real report component with lightweight native table/card primitives.
const require=createRequire(import.meta.url)
const sheetSource=readFileSync(new URL('../src/features/results/ResultSheet.tsx',import.meta.url),'utf8')
const sheetCode=ts.transpileModule(sheetSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
const tags={Badge:'span',Card:'section',CardContent:'div',Table:'table',TableBody:'tbody',TableCell:'td',TableHead:'th',TableHeader:'thead',TableRow:'tr'}
const context={exports:{},require:name=>name.startsWith('@/components/ui/')?Object.fromEntries(Object.entries(tags).map(([name,tag])=>[name,({children,...props})=>React.createElement(tag,props,children)])):require(name)}
vm.runInNewContext(sheetCode,context)
const result={exam:{marks_mode:'total_only',exam_type:'Tutorial exam',academic_year:'2035',class_name:'Class 11',grade:'11',section:'A',exam_date:'2035-03-05'},student:{full_name:'Example Student',admission_number:'28001'},summary:{total_obtained:0,total_max:20,gpa:null,letter_grade:null,position:2,total_students:2,failed_subjects:0},subjects:[{id:'subject',name:'Bangla',code:'BAN',creative_max:0,written_max:20,practical_max:0,creative_marks:null,written_marks:0,practical_marks:null,obtained:0,total_max:20,is_absent:false,passed:null,letter_grade:null,grade_point:null,creative_pass_mark:0,written_pass_mark:0,practical_pass_mark:0}]}
const markup=renderToStaticMarkup(React.createElement(context.exports.ResultSheet,{result}))
for(const label of ['GPA','Failed subjects','Creative','MCQ','Practical','Pass mark:']) assert.ok(!markup.includes(label),`Tutorial report must not show ${label}`)
assert.ok(markup.includes('0 / 20'),'A zero mark must be displayed as a real total')
const regular=renderToStaticMarkup(React.createElement(context.exports.ResultSheet,{result:{...result,exam:{...result.exam,marks_mode:'sectioned'},summary:{...result.summary,gpa:0,letter_grade:'F',failed_subjects:1}}}))
assert.ok(regular.includes('GPA')&&regular.includes('Creative')&&regular.includes('MCQ'))
assert.match(regular, /<dt>Position<\/dt><dd>Failed<\/dd>/, 'An overall failure must display Failed instead of a position')
const unorderedSubjects = [
  ['Chemistry', '178+179', 'fourth'], ['ICT', '275', 'main'], ['English', '107+108', 'main'], ['Bangla', '101+102', 'main'], ['Physics', '174+175', 'main'],
].map(([name,code,subject_role],index)=>({...result.subjects[0],id:String(index),name,code,subject_role}))
const orderedReport=renderToStaticMarkup(React.createElement(context.exports.ResultSheet,{result:{...result,subjects:unorderedSubjects}}))
const names=[...orderedReport.matchAll(/<span class="block">([^<]+)<\/span>/g)].map(match=>match[1])
assert.deepEqual(names,['Bangla','English','ICT','Chemistry','Physics'])
assert.deepEqual(unorderedSubjects.map(subject=>subject.name),['Chemistry','ICT','English','Bangla','Physics'],'Rendering must not mutate query data')
assert.equal((orderedReport.match(/4th subject/g)??[]).length,1,'Only the student-assigned fourth subject is labelled')
assert.ok(orderedReport.indexOf('178+179')<orderedReport.indexOf('4th subject'))
assert.match(markup, /<dt>Position<\/dt><dd>2 of 2<\/dd>/, 'Ungraded exams retain their existing position')
const tutorialReport=renderToStaticMarkup(React.createElement(context.exports.ResultSheet,{result:{...result,exam:{...result.exam,marks_mode:'total_pass'},
  subjects:[{...result.subjects[0],...cqMcqSubject,creative_marks:0,written_marks:6.6,obtained:6.6,pass_mark:6.6,passed:true,letter_grade:'D',grade_point:1}]}}))
assert.ok(tutorialReport.includes('CQ')&&tutorialReport.includes('MCQ')&&tutorialReport.includes('Total pass: 6.6'))
assert.ok(!tutorialReport.includes('Practical')&&!tutorialReport.includes('Pass mark:'),'Tutorial reports have no practical or individual section passing')
const attendanceReport=renderToStaticMarkup(React.createElement(context.exports.ResultSheet,{result:{...result,attendance:{
  start_date:'2035-01-08',end_date:'2035-01-16',total_classes:5,present_count:3,present_percentage:60}}}))
for(const text of ['Amount of classes','Present percentage','60%','2035-01-08 to 2035-01-16']) assert.ok(attendanceReport.includes(text),`Report attendance missing ${text}`)
assert.ok(attendanceReport.includes('data-report-attendance'))
console.log('Passed tutorial configuration, metadata-driven behavior, positive totals, zero-mark rendering, no grading/section fields in reports, and regular-exam regressions.')
