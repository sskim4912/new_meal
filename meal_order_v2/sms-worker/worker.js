const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
export async function validateRequest(request,env) {
  if (!env.SMS_ADMIN_TOKEN || env.SMS_ADMIN_TOKEN.length < 32 || !env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !/^\d{8,11}$/.test(env.SOLAPI_FROM_NUMBER||'')) return {error:'문자 서버 설정이 완료되지 않았습니다.',status:503};
  const received=request.headers.get('Authorization')||'';
  const expected=`Bearer ${env.SMS_ADMIN_TOKEN}`;
  const digest=async v=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
  const [a,b]=await Promise.all([digest(received),digest(expected)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff) return {error:'문자 발송 인증키를 확인해주세요.',status:401};
  if(Number(request.headers.get('content-length'))>12000) return {error:'요청이 너무 큽니다.',status:413};
  let body;try {const raw=await request.text();if(raw.length>12000)return {error:'요청이 너무 큽니다.',status:413};body=JSON.parse(raw);}catch{return {error:'잘못된 요청입니다.',status:400};}
  if(!/^01[016789]\d{7,8}$/.test(body.to||'') || typeof body.text!=='string' || !body.text.trim() || new TextEncoder().encode(body.text).length>2000 || !/^[a-f0-9-]{36}$/i.test(body.requestId||'')) return {error:'수신번호, 문자 길이 또는 요청 번호를 확인해주세요.',status:400};
  return {body};
}
export default {
 async fetch(request,env) {
  const origin=request.headers.get('Origin');
  const headers={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Cache-Control':'no-store'};
  const wrap=r=>new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...headers}});
  if(origin!==env.ALLOWED_ORIGIN) return json({error:'허용되지 않은 출처입니다.'},403);
  if(new URL(request.url).pathname!=='/send') return wrap(json({error:'경로를 확인해주세요.'},404));
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return wrap(json({error:'POST 요청만 지원합니다.'},405));
  const result=await validateRequest(request,env);
  if(result.error)return wrap(json({error:result.error},result.status));
  const id=env.REQUESTS.idFromName(result.body.requestId);
  return wrap(await env.REQUESTS.get(id).fetch(new Request('https://internal/send',{method:'POST',body:JSON.stringify(result.body)})));
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
   const record={to:body.to,text:body.text,status:409,response:{error:'발송 결과를 확인할 수 없습니다. 솔라피 발송 내역을 확인하고 재발송 여부를 결정해주세요.'}};
   await this.state.storage.put('result',record);
   try{
    const date=new Date().toISOString(),salt=crypto.randomUUID().replaceAll('-','');
    const enc=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',enc.encode(this.env.SOLAPI_API_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(date+salt)))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const response=await fetch('https://api.solapi.com/messages/v4/send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`HMAC-SHA256 apiKey=${this.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`},body:JSON.stringify({message:{to:body.to,from:this.env.SOLAPI_FROM_NUMBER,type:'LMS',subject:'Aurora Project 식사 신청 집계',text:body.text}}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok || String(result.statusCode)!=='2000' || !result.messageId){
     record.status=502;record.response={error:'솔라피가 발송 요청을 접수하지 못했습니다. 발신번호, 잔액 및 솔라피 발송 내역을 확인해주세요.'};
    }else{record.status=200;record.response={status:'accepted',messageId:result.messageId};}
    await this.state.storage.put('result',record);
   }catch{/* Ambiguous outcomes stay blocked rather than sending a duplicate. */}
   return json(record.response,record.status);
  });
 }
}
