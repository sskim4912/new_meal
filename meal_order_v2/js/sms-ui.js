import { SMS } from './sms-config.js?v=20261013-connected';
import { buildMealMessage, normalizePhone, requestSms } from './sms.js';
import { $, status } from './utils.js';
export function initSms(getState) {
  let busy=false;
  const requests=new Map();
  $('smsButton').addEventListener('click',()=>{
    const {unlocked,rows,query}=getState();
    if(!unlocked || !query || $('smsButton').disabled)return;
    try{
      $('smsPreview').value=buildMealMessage(rows,query);
      const ready=SMS.endpoint && getState().smsToken;
      status('smsStatus',!SMS.endpoint?'문자 서버 연결 설정이 필요합니다.':!getState().smsToken?'관리자 잠금 후 다시 로그인할 때 문자 발송 인증키를 한 번 입력해주세요.':'수신번호와 내용을 확인한 뒤 발송해주세요.',!ready);
      $('sendSms').disabled=!ready;
      $('smsDialog').showModal();
    }catch(e){status('adminStatus',e.message,true);}
  });
  $('closeSms').addEventListener('click',()=>{if(!busy)$('smsDialog').close();});
  $('smsDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('sendSms').addEventListener('click',async()=>{
    if(!getState().unlocked || busy || !SMS.endpoint)return;
    let to;try{to=normalizePhone($('smsPhone').value);}catch(e){status('smsStatus',e.message,true);return;}
    const token=getState().smsToken,text=$('smsPreview').value;
    if(!token){status('smsStatus','관리자 로그인 때 문자 발송 인증키를 입력해주세요.',true);return;}
    if(!window.confirm(`${to} 번호로 현재 집계를 발송할까요? 문자 발송 비용이 발생합니다.`))return;
    busy=true;$('sendSms').disabled=true;$('closeSms').disabled=true;
    status('smsStatus','발송 요청 중…');
    const key=JSON.stringify([to,text]),requestId=requests.get(key)??crypto.randomUUID();requests.set(key,requestId);
    try{
      await requestSms({endpoint:SMS.endpoint,token,to,text,requestId});
      status('smsStatus','솔라피에 발송 요청이 접수되었습니다. 실제 전달 결과는 솔라피 발송 내역에서 확인하세요.');
    }catch(e){status('smsStatus',`${e.name==='TimeoutError'||e.name==='TypeError'?'접수 여부를 확인하지 못했습니다.':e.message} 자동 재발송하지 말고 솔라피 발송 내역을 먼저 확인해주세요.`,true);}
    finally{busy=false;$('closeSms').disabled=false;}
  });
}
