import { SMS } from './sms-config.js';
import { buildMealMessage, normalizePhone, requestSms } from './sms.js?v=20261016-admin-v2';
import { $, status, confirmAction } from './utils.js';
import { adminRequest } from './admin-session.js';
export function initSms(getState) {
  let busy=false, reportId=null, previewVersion=0;
  const requests=new Map();
  async function preview() {
    const version=++previewVersion;
    reportId=null;$('sendSms').disabled=true;
    const {rows,query,token}=getState();
    if(!query||!token){status('smsStatus','관리자 로그인을 다시 확인해주세요.',true);return;}
    try{
      const kind=$('smsKind').value;
      if(kind==='general') $('smsPreview').value=buildMealMessage(rows,query);
      else {
        if(query.mode!=='day'||query.group!=='all')throw new Error('중식 1차·최종 집계는 일별·전체 구분으로 조회해주세요.');
        status('smsStatus','서버에서 중식 집계를 불러오는 중…');
        const data=await adminRequest('/reports/preview',{date:query.date,kind});
        if(version!==previewVersion||!$('smsDialog').open)return;
        reportId=data.reportId;$('smsPreview').value=data.text;
      }
      if(version!==previewVersion)return;
      $('sendSms').disabled=!SMS.endpoint;
      status('smsStatus','수신번호와 집계 기준 시각을 확인한 뒤 발송해주세요.');
    }catch(error){if(version===previewVersion){$('smsPreview').value='';status('smsStatus',error.message,true);}}
  }
  $('smsButton').addEventListener('click',()=>{
    const {unlocked,query}=getState();if(!unlocked||!query||$('smsButton').disabled)return;
    $('smsDialog').showModal();preview();
  });
  $('smsKind').addEventListener('change',preview);
  $('closeSms').addEventListener('click',()=>{if(!busy){previewVersion++;$('smsDialog').close();}});
  $('smsDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else previewVersion++;});
  $('sendSms').addEventListener('click',async()=>{
    if(!getState().unlocked||busy||!SMS.endpoint||$('sendSms').disabled)return;
    let to;try{to=normalizePhone($('smsPhone').value);}catch(error){status('smsStatus',error.message,true);return;}
    const token=getState().token,text=$('smsPreview').value,selectedReport=reportId;
    if(!token){status('smsStatus','관리자 로그인을 다시 해주세요.',true);return;}
    busy=true;$('sendSms').disabled=true;$('closeSms').disabled=true;$('smsKind').disabled=true;
    const confirmed=await confirmAction('문자 발송 확인',`${to} 번호로 현재 집계를 발송할까요?\n문자 발송 비용이 발생합니다.`);
    if(!confirmed){busy=false;$('sendSms').disabled=false;$('closeSms').disabled=false;$('smsKind').disabled=false;return;}
    status('smsStatus','발송 요청 중…');
    try{
      const key=JSON.stringify([to,text]),requestId=requests.get(key)??crypto.randomUUID();requests.set(key,requestId);
      const result=await requestSms({endpoint:SMS.endpoint,token,to,text,requestId,reportId:selectedReport});
      status('smsStatus',result.snapshotSaved===false?'발송은 접수됐지만 1차 비교 기록 저장에 실패했습니다. 최종 집계의 비교 기록을 확인해주세요.':'솔라피에 발송 요청이 접수되었습니다. 실제 전달 결과는 솔라피 발송 내역에서 확인하세요.',result.snapshotSaved===false);
    }catch(error){status('smsStatus',`${error.name==='TimeoutError'||error.name==='TypeError'?'접수 여부를 확인하지 못했습니다.':error.message} 자동 재발송하지 말고 솔라피 발송 내역을 먼저 확인해주세요.`,true);}
    finally{busy=false;$('closeSms').disabled=false;$('smsKind').disabled=false;}
  });
}
