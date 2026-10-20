'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const start=source.indexOf('function syncRecordStudent(){');
const end=source.indexOf('function historySeen(',start);
assert(start>=0&&end>start,'individual-exam student binding must exist');
const field={
 value:'',
 options:[{value:'',textContent:'請選擇學生'},{value:'815-09',textContent:'815-09'}],
 add(option){this.options.push(option);}
};
let current={id:'paper-1',mode:'individual',student:'815-09'};
const sandbox={
 document:{createElement(tag){assert.equal(tag,'option');return {value:'',textContent:''};}},
 $:id=>id==='recordStudent'?field:null,
 val:id=>id==='recordPaper'?'paper-1':'',
 paperOf:id=>id==='paper-1'?current:null
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start,end),sandbox);
vm.runInContext('syncRecordStudent();',sandbox);
assert.equal(field.value,'815-09','individual paper must auto-select its own student');
current={id:'paper-1',mode:'individual',student:'815-25'};
vm.runInContext('syncRecordStudent();',sandbox);
assert.equal(field.value,'815-25','historical student still must be selectable');
assert(field.options.some(x=>x.value==='815-25'),'missing historical student should be added as option');
const length=field.options.length;
vm.runInContext('syncRecordStudent();',sandbox);
assert.equal(field.options.length,length,'do not add duplicate students');
current={id:'paper-1',mode:'class',student:''};
field.value='815-09';
vm.runInContext('syncRecordStudent();',sandbox);
assert.equal(field.value,'815-09','class paper retains teacher-selected student');
current=null;
vm.runInContext('syncRecordStudent();',sandbox);
assert.equal(field.value,'815-09','no paper selected retains student value');
assert(source.includes("$('recordPaper').onchange=function(){syncRecordStudent();loadExistingRecord();};"),
 'changing record paper must synchronize student before loading old answer records');
const segment=source.slice(source.indexOf('function paperList(){'),source.indexOf('async function renderPreview(){'));
assert(segment.includes('syncRecordStudent();'),'refreshing the paper list must also synchronize individual student');
console.log('Student auto-binding tests passed: individual, stale roster, class and refresh');
