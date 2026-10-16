import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminState } from '../sms-worker/admin-state.js';
import worker, { SmsRequest } from '../sms-worker/worker.js';
import { proxySave } from '../sms-worker/firebase.js';
import { validateProxy, PROXY_SOURCE } from '../js/vip-rules.js';
import { validateChange } from '../js/meal-rules.js';
import { lunchSnapshot, buildLunchReport } from '../js/lunch-report.js';
import { aggregate } from '../js/aggregate.js';

function state() {
  const data=new Map();
  return { data, blockConcurrencyWhile:fn=>fn(),storage:{get:async key=>data.get(key),put:async(key,value)=>data.set(key,structuredClone(value)),delete:async key=>data.delete(key),setAlarm:async()=>{},list:async()=>data} };
}
function setup() {
  const env={ALLOWED_ORIGIN:'https://sskim4912.github.io',ADMIN_PASSWORD:'230880'};
  const actor=new AdminState(state(),env);
  env.ADMIN={idFromName:name=>name,get:()=>actor};
  return {env,actor};
}
const req=(path,body)=>new Request('https://worker.example'+path,{method:'POST',body:JSON.stringify(body)});
const candidate=(date='2026-10-16')=>({id:'proxy:11111111-1111-4111-8111-111111111111',requesterKey:'proxy-person',date,group:'vip',company:'본사',name:'동명이인',operatorName:'김담당',empId:'',phone:'',meal:'lunch',menu:'백반',location:'사무실',source:PROXY_SOURCE,quantity:1});
test('admin password is verified on server; sessions expire and logout revokes; brute force is limited',async()=>{
  const {actor}=setup();
  for(let i=0;i<5;i++)assert.equal((await actor.fetch(req('/login',{password:'wrong',ip:'bad'}))).status,401);
  assert.equal((await actor.fetch(req('/login',{password:'230880',ip:'bad'}))).status,429);
  const session=await(await actor.fetch(req('/login',{password:'230880',ip:'good'}))).json();
  assert.equal(session.token.length,64);
  assert.equal((await actor.fetch(req('/verify',{token:'230880'}))).status,401);
  assert.equal((await actor.fetch(req('/verify',{token:session.token}))).status,200);
  await actor.fetch(req('/logout',{token:session.token}));
  assert.equal((await actor.fetch(req('/verify',{token:session.token}))).status,401);
  const expired=await(await actor.fetch(req('/login',{password:'230880',ip:'other'}))).json();
  const now=Date.now;Date.now=()=>expired.expiresAt;
  try{assert.equal((await actor.fetch(req('/verify',{token:expired.token}))).status,401);}finally{Date.now=now;}
});
test('VIP lunch has a 10:00 cutoff, normal lunch stays at 09:00; invalid location/quantity/past dates rejected',()=>{
  const before=Date.parse('2026-10-16T09:59:59+09:00'),at=Date.parse('2026-10-16T10:00:00+09:00');
  validateProxy(candidate(),before);
  assert.throws(()=>validateChange(candidate(),before),/마감/);
  assert.throws(()=>validateProxy(candidate(),at),/10:00/);
  validateProxy(candidate('2026-10-17'),at);
  for(const change of [{quantity:2},{operatorName:''},{operatorName:' '.repeat(3)},{operatorName:'가'.repeat(41)},{operatorName:123},{location:'OSBL'},{meal:'dinner'},{source:'direct'},{date:'2026-10-15'}])assert.throws(()=>validateProxy({...candidate(),...change},before));
});
test('proxy endpoint warns about duplicates without writing, then uses server Firebase credentials after acknowledgement',async()=>{
  const originalFetch=globalThis.fetch,now=Date.now;
  Date.now=()=>Date.parse('2026-10-16T09:30:00+09:00');
  const existing={...candidate(),id:'gs-order',group:'gs',source:undefined};delete existing.source;
  const fields=Object.fromEntries(Object.entries(existing).map(([key,value])=>[key,typeof value==='number'?{integerValue:String(value)}:{stringValue:value}]));
  let commits=0;
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('signInWithPassword'))return Response.json({idToken:'server-only-firebase-token',expiresIn:'3600'});
    if(String(url).endsWith(':runQuery'))return Response.json([{document:{fields}}]);
    if(String(url).endsWith(':commit')){const payload=JSON.parse(options.body);assert.equal(payload.writes[0].update.fields.operatorName.stringValue,'김담당');assert.equal(payload.writes[0].update.fields.quantity.integerValue,'1');assert.equal(options.headers.Authorization,'Bearer server-only-firebase-token');commits++;return Response.json({writeResults:[{}]});}
    throw new Error('Unexpected request');
  };
  try{
    const env={FIREBASE_ADMIN_EMAIL:'test@example.test',FIREBASE_ADMIN_PASSWORD:'test-only'};
    await assert.rejects(proxySave(env,{rows:[{...candidate(),operatorName:undefined}]}),/대리입력자/);assert.equal(commits,0);
    const warned=await proxySave(env,{rows:[candidate()]});assert.equal(warned.duplicates.length,1);assert.equal(commits,0);
    assert.equal((await proxySave(env,{rows:[candidate()],confirmDuplicates:true})).saved,1);assert.equal(commits,1);
    assert.throws(()=>validateProxy({...candidate(),location:'ISBL'},Date.now()));
    Date.now=()=>Date.parse('2026-10-16T10:00:00+09:00');
    await assert.rejects(proxySave(env,{rows:[candidate()],confirmDuplicates:true}),/10:00/);assert.equal(commits,1);
  }finally{globalThis.fetch=originalFetch;Date.now=now;}
});
test('all protected API routes reject a fake session, and a legacy SMS key cannot bypass session verification',async()=>{
  const {env}=setup();
  for(const path of ['/send','/vip/save','/orders/delete','/reports/preview']){
    const request=new Request('https://worker.example'+path,{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,Authorization:'Bearer old-sms-secret'},body:'{}'});
    assert.equal((await worker.fetch(request,env)).status,401);
  }
});
test('gateway builds authoritative lunch preview and ignores forged client snapshot/text during report sending',async()=>{
  const {env,actor}=setup();
  Object.assign(env,{SOLAPI_API_KEY:'fake',SOLAPI_API_SECRET:'fake',SOLAPI_FROM_NUMBER:'0212345678'});
  const sent=[];
  env.REQUESTS={idFromName:name=>name,get:()=>({fetch:async request=>{sent.push(await request.json());return Response.json({status:'accepted',messageId:'mock-only'});}})};
  const session=await(await actor.fetch(req('/login',{password:'230880',ip:'preview'}))).json();
  const call=(path,body)=>worker.fetch(new Request('https://worker.example'+path,{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,Authorization:`Bearer ${session.token}`},body:JSON.stringify(body)}),env);
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json([{document:{fields:Object.fromEntries(Object.entries(candidate()).map(([key,value])=>[key,typeof value==='number'?{integerValue:String(value)}:{stringValue:value}]))}}]);
  try{
    const preview=await(await call('/reports/preview',{date:'2026-10-16',kind:'first'})).json();
    assert.match(preview.text,/중식 1차 집계/);assert.match(preview.text,/전체: 1개/);assert(!preview.text.includes('동명이인'));
    const response=await call('/send',{to:'01012345678',requestId:crypto.randomUUID(),reportId:preview.reportId,text:'forged',snapshot:{total:999}});
    assert.equal(response.status,200);assert.equal(sent[0].text,preview.text);assert.equal(sent[0].snapshot.total,1);
    assert.match(sent[0].snapshot.items[0].id,/^[a-f0-9]{64}$/);
    assert.equal((await call('/send',{to:'01012345678',requestId:crypto.randomUUID(),reportId:'missing',text:'forged'})).status,409);
  }finally{globalThis.fetch=original;}
});
test('final lunch report compares actual accepted first snapshot, including moves and cancellations; aggregates count proxy once',()=>{
  const date='2026-10-16';
  const first=lunchSnapshot([{...candidate(),id:'a'},{...candidate(),id:'b',location:'OSBL'}],date,'2026-10-16T00:00:00Z');
  const final=lunchSnapshot([{...candidate(),id:'a',location:'ISBL'},{...candidate(),id:'c'},{...candidate(),id:'d'}],date,'2026-10-16T01:00:00Z');
  const text=buildLunchReport(final,'final',first);
  assert.match(text,/전체: 3개/);assert.match(text,/1차 대비: \+1개/);assert.match(text,/추가 2개 \/ 취소 1개 \/ 변경 1개/);
  assert.match(text,/OSBL: 0개 \(-1\)/);assert.match(text,/집계 기준:/);
  assert(!text.includes('동명이인'));
  assert.match(buildLunchReport(final,'final',null),/1차 발송 기록 없음/);
  assert.equal(aggregate([candidate()],['meal'])[0].quantity,1);
});
test('only provider-accepted first reports persist comparison snapshots; accepted retries do not resend or rewrite baseline',async()=>{
  const {env,actor}=setup();Object.assign(env,{SOLAPI_API_KEY:'fake',SOLAPI_API_SECRET:'fake',SOLAPI_FROM_NUMBER:'0212345678'});
  const realFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({statusCode:'2000',messageId:'accepted-once'});
    const sender=new SmsRequest(state(),env),snapshot=lunchSnapshot([candidate()],'2026-10-16');
    const body={to:'01012345678',text:'1차 집계',kind:'first',snapshot};
    assert.equal((await sender.fetch(req('/send',body))).status,200);
    const first=(await(await actor.fetch(req('/snapshot/get',{date:snapshot.date}))).json()).snapshot;
    assert.equal(first.messageId,'accepted-once');
    globalThis.fetch=async()=>{throw new Error('Provider must not be called twice');};
    assert.equal((await sender.fetch(req('/send',body))).status,200);
    globalThis.fetch=async()=>Response.json({statusCode:'failed'},{status:400});
    const failed=new SmsRequest(state(),env);
    assert.equal((await failed.fetch(req('/send',{...body,snapshot:{...snapshot,total:99}}))).status,502);
    assert.equal((await(await actor.fetch(req('/snapshot/get',{date:snapshot.date}))).json()).snapshot.total,1);
  }finally{globalThis.fetch=realFetch;}
});
