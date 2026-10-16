import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import mock_admin_auth
BASE=os.environ.get('AURORA_TEST_URL','http://127.0.0.1:8001')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for configured,outcome in [(True,'accepted'),(True,'rejected')]:
  c=b.new_context(viewport={'width':390,'height':900})
  mock_admin_auth(c)
  c.route('**/js/firebase-config.js',lambda r:r.fulfill(content_type='text/javascript',body='export const FIREBASE={enabled:false};'))
  if not configured:c.route('**/js/sms-config.js*',lambda r:r.fulfill(content_type='text/javascript',body="export const SMS={endpoint:''};"))
  if configured:c.route('**/js/sms-config.js*',lambda r:r.fulfill(content_type='text/javascript',body="export const SMS={endpoint:'https://sms.example/send'};"))
  def preview(route):
   body=route.request.post_data_json
   route.fulfill(content_type='application/json',body=json.dumps({'reportId':'preview-'+body['kind'],'text':'중식 '+('1차 집계' if body['kind']=='first' else '최종 집계')+' / 집계 기준: 09:00 / 전체: 1개'}))
  c.route('**/reports/preview',preview)
  calls=[]
  def send(r):
   calls.append(r.request.post_data_json)
   r.fulfill(status=200 if outcome=='accepted' else 502,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps({'status':'accepted','messageId':'test'} if outcome=='accepted' else {'error':'인증 실패'}))
  c.route('https://sms.example/send',send)
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  page.goto(BASE+'/admin.html')
  page.evaluate("localStorage.setItem('aurora.v2.orders',JSON.stringify([{id:'test',date:document.querySelector('#queryDate').value,group:'gs',meal:'lunch',location:'ISBL',menu:'백반',name:'PRIVATE',empId:'SECRET'}]))")
  page.locator('#password').fill('230880')
  assert page.locator('#loginSmsToken').count()==0
  page.locator('#passwordForm .primary').click()
  page.locator('#scheduleSmsButton').click();expect(page.locator('#scheduleSmsDialog')).to_be_visible();page.locator('#scheduleSmsDialog button').click();assert not calls
  expect(page.locator('#smsButton')).to_be_enabled();page.locator('#smsButton').click();expect(page.locator('#smsDialog')).to_be_visible()
  assert '총 1개 / 8,000원' in page.locator('#smsPreview').input_value()
  assert 'PRIVATE' not in page.locator('#smsPreview').input_value()
  if not configured:expect(page.locator('#sendSms')).to_be_disabled()
  else:
   page.locator('#smsPhone').fill('invalid');page.locator('#sendSms').click();expect(page.locator('#smsStatus')).to_contain_text('번호');assert not calls
   page.locator('#smsPhone').fill('01012345678');page.locator('#sendSms').click()
   expect(page.locator('#confirmDialog')).to_be_visible();assert not calls
   page.locator('#confirmDialog button[value="no"]').click();expect(page.locator('#sendSms')).to_be_enabled();assert not calls
   page.locator('#sendSms').click();page.locator('#confirmDialog button[value="yes"]').click()
   expect(page.locator('#smsStatus')).to_contain_text('접수되었습니다' if outcome=='accepted' else '인증 실패')
   assert len(calls)==1;expect(page.locator('#sendSms')).to_be_disabled()
  page.locator('#closeSms').click();assert page.locator('#smsToken').count()==0
  if outcome=='accepted':
   for kind in ['first','final']:
    page.locator('#smsButton').click();page.locator('#smsKind').select_option(kind)
    expect(page.locator('#smsPreview')).to_have_value('중식 '+('1차 집계' if kind=='first' else '최종 집계')+' / 집계 기준: 09:00 / 전체: 1개')
    page.locator('#sendSms').click();page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#smsStatus')).to_contain_text('접수되었습니다')
    assert calls[-1]['reportId']=='preview-'+kind
    page.locator('#closeSms').click()
  assert 'test-only-session-token' not in page.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
  if configured:
   page.locator('#smsButton').click();expect(page.locator('#sendSms')).to_be_enabled();page.locator('#closeSms').click()
  page.locator('#queryDate').fill('2000-01-01');page.locator('#queryDate').dispatch_event('change');expect(page.locator('#smsButton')).to_be_disabled()
  page.locator('#logoutButton').click();page.get_by_role('link',name='관리자 집계',exact=True).click();page.locator('#password').fill('230880');page.locator('#passwordForm .primary').click()
  assert page.locator('#loginSmsToken').count()==0
  assert not errors,errors
  c.close()
 b.close()
print('PASS: browser preview, unconfigured state, invalid recipient, login-session auth reuse, accepted/rejected results, empty query, logout clearing and schedule placeholder; no real SMS sent')

