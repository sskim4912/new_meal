const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
export function validateSmsPayload(body, env) {
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !/^\d{8,11}$/.test(env.SOLAPI_FROM_NUMBER || '')) return { error: '문자 서버 설정이 완료되지 않았습니다.', status: 503 };
  if (!body || !/^01[016789]\d{7,8}$/.test(body.to || '') || typeof body.text !== 'string' || !body.text.trim() || new TextEncoder().encode(body.text).length > 2000 || !/^[a-f0-9-]{36}$/i.test(body.requestId || '')) return { error: '수신번호, 문자 길이 또는 요청 번호를 확인해주세요.', status: 400 };
  return { body };
}
export { AdminState } from './admin-state.js';
import { ApiError, allOrders, proxySave, deleteOrders, digest } from './firebase.js';
import { lunchSnapshot, buildLunchReport, kstTime } from '../js/lunch-report.js';
async function registry(env, path, body) {
  if (!env.ADMIN) throw new ApiError('관리자 서버 업데이트가 필요합니다. Worker 배포 상태를 확인해주세요.', 503);
  const response = await env.ADMIN.get(env.ADMIN.idFromName('registry')).fetch(new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(body) }));
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error, response.status);
  return data;
}
export default {
 async fetch(request,env) {
  const headers={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Cache-Control':'no-store'};
  const wrap=r=>new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...headers}});
  if(request.headers.get('Origin')!==env.ALLOWED_ORIGIN) return json({error:'허용되지 않은 출처입니다.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return wrap(json({error:'POST 요청만 지원합니다.'},405));
  try {
    const raw = await request.text();
    if(raw.length > 500000) throw new ApiError('요청이 너무 큽니다.',413);
    let body;try{body=JSON.parse(raw);}catch{throw new ApiError('잘못된 요청입니다.');}
    const path = new URL(request.url).pathname;
    if(path === '/auth/login') return wrap(json(await registry(env,'/login',{password:body.password,ip:request.headers.get('CF-Connecting-IP') || 'unknown'})));
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /,'');
    await registry(env,'/verify',{token});
    if(path === '/auth/verify') return wrap(json({ok:true}));
    if(path === '/auth/logout') return wrap(json(await registry(env,'/logout',{token})));
    if(path === '/vip/list') return wrap(json({rows:(await allOrders(env,body.date)).filter(row=>row.source==='admin-proxy')}));
    if(path === '/vip/save') return wrap(json(await proxySave(env,body)));
    if(path === '/orders/delete') return wrap(json(await deleteOrders(env,body)));
    if(path === '/reports/preview') {
      if(!['first','final'].includes(body.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw new ApiError('중식 집계 날짜와 종류를 확인해주세요.');
      const reportRows=await Promise.all((await allOrders(env,body.date)).map(async row=>({...row,id:await digest(row.id)})));
      const snapshot=lunchSnapshot(reportRows,body.date);
      const {snapshot:first}=await registry(env,'/snapshot/get',{date:body.date});
      const text=buildLunchReport(snapshot,body.kind,first);
      const {id}=await registry(env,'/preview/set',{preview:{snapshot,kind:body.kind,text}});
      return wrap(json({reportId:id,text}));
    }
    if(path !== '/send') return wrap(json({error:'경로를 확인해주세요.'},404));
    if(!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !/^\d{8,11}$/.test(env.SOLAPI_FROM_NUMBER || '')) throw new ApiError('문자 서버 설정이 완료되지 않았습니다.',503);
    if(!/^01[016789]\d{7,8}$/.test(body.to || '') || !/^[a-f0-9-]{36}$/i.test(body.requestId || '')) throw new ApiError('수신번호 또는 요청 번호를 확인해주세요.');
    if(body.reportId) {
      const {preview}=await registry(env,'/preview/get',{id:body.reportId});
      body.text=preview.text;body.snapshot=preview.snapshot;body.kind=preview.kind;
      body.subject=preview.kind==='first'?'중식 1차 집계':'중식 최종 집계';
    } else {
      delete body.snapshot;delete body.kind;delete body.subject;
    }
    const validation=validateSmsPayload(body,env);
    if(validation.error)throw new ApiError(validation.error,validation.status);
    // Durable Object에서 요청 시각을 한 번만 생성하여 재시도해도 같은 내용으로 처리합니다.
    return wrap(await env.REQUESTS.get(env.REQUESTS.idFromName(body.requestId)).fetch(new Request('https://internal/send',{method:'POST',body:JSON.stringify(body)})));
  } catch(error) {
    return wrap(json({error:error instanceof ApiError || error.status ? error.message : '서버 요청에 실패했습니다. 배포 설정과 연결을 확인해주세요.',partialDeletion:error.partialDeletion || false},error.status || 502));
  }
 }
};
export class SmsRequest {
 constructor(state,env){this.state=state;this.env=env;}
 async fetch(request){
  return this.state.blockConcurrencyWhile(async()=>{
   const body=await request.json();
   const previous=await this.state.storage.get('result');
   if(previous){
    if(previous.to!==body.to || previous.text!==body.text)return json({error:'동일 요청 번호의 내용이 변경되었습니다.'},409);
    return json(previous.response,previous.status);
   }
   const requestedAt=new Date().toISOString();
   const outgoingText=body.text+`\n\n발송 요청: ${kstTime(requestedAt)} (KST)`;
   if(new TextEncoder().encode(outgoingText).length>2000)return json({error:'발송 시각을 포함한 문자 내용이 너무 깁니다. 조회 범위를 줄여주세요.'},413);
   const record={to:body.to,text:body.text,status:409,response:{error:'발송 결과를 확인할 수 없습니다. 솔라피 발송 내역을 확인하고 재발송 여부를 결정해주세요.'}};
   await this.state.storage.put('result',record);
   try{
    const date=new Date().toISOString(),salt=crypto.randomUUID().replaceAll('-','');
    const enc=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',enc.encode(this.env.SOLAPI_API_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(date+salt)))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const response=await fetch('https://api.solapi.com/messages/v4/send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`HMAC-SHA256 apiKey=${this.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`},body:JSON.stringify({message:{to:body.to,from:this.env.SOLAPI_FROM_NUMBER,type:'LMS',subject:body.subject || 'Aurora Project 식사 신청 집계',text:outgoingText}}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok || String(result.statusCode)!=='2000' || !result.messageId){
     record.status=502;record.response={error:'솔라피가 발송 요청을 접수하지 못했습니다. 발신번호, 잔액 및 솔라피 발송 내역을 확인해주세요.'};
    }else{record.status=200;record.response={status:'accepted',messageId:result.messageId,requestedAt};
     if(body.kind==='first' && body.snapshot){
      try{await registry(this.env,'/snapshot/set',{snapshot:{...body.snapshot,requestedAt,messageId:result.messageId}});record.response.snapshotSaved=true;}
      catch{record.response.snapshotSaved=false;}
     }}
    await this.state.storage.put('result',record);
   }catch{/* Ambiguous outcomes stay blocked rather than sending a duplicate. */}
   return json(record.response,record.status);
  });
 }
}
