import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('AURORA_TEST_URL','http://127.0.0.1:8001')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for configured,outcome in [(False,'accepted'),(True,'accepted'),(True,'rejected')]:
  c=b.new_context(viewport={'width':390,'height':900})
  c.route('**/js/firebase-config.js',lambda r:r.fulfill(content_type='text/javascript',body='export const FIREBASE={enabled:false};'))
  if configured:c.route('**/js/sms-config.js',lambda r:r.fulfill(content_type='text/javascript',body="export const SMS={endpoint:'https://sms.example/send'};"))
  calls=[]
  def send(r):
   calls.append(r.request.post_data_json)
   r.fulfill(status=200 if outcome=='accepted' else 401,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps({'status':'accepted','messageId':'test'} if outcome=='accepted' else {'error':'인증 실패'}))
  c.route('https://sms.example/send',send)
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  page.goto(BASE+'/admin.html')
  page.evaluate("localStorage.setItem('aurora.v2.orders',JSON.stringify([{id:'test',date:document.querySelector('#queryDate').value,group:'gs',meal:'lunch',location:'ISBL',menu:'백반',name:'PRIVATE',empId:'SECRET'}]))")
  page.locator('#password').fill('230880');page.locator('#passwordForm .primary').click()
  expect(page.locator('#smsButton')).to_be_enabled();page.locator('#smsButton').click();expect(page.locator('#smsDialog')).to_be_visible()
  assert '총 1개 / 8,000원' in page.locator('#smsPreview').input_value()
  assert 'PRIVATE' not in page.locator('#smsPreview').input_value()
  if not configured:expect(page.locator('#sendSms')).to_be_disabled()
  else:
   page.locator('#smsPhone').fill('invalid');page.locator('#sendSms').click();expect(page.locator('#smsStatus')).to_contain_text('번호');assert not calls
   page.locator('#smsPhone').fill('01012345678');page.locator('#sendSms').click();expect(page.locator('#smsStatus')).to_contain_text('인증키');assert not calls
   page.locator('#smsToken').fill('test-only');page.locator('#sendSms').click()
   expect(page.locator('#smsStatus')).to_contain_text('접수되었습니다' if outcome=='accepted' else '인증 실패')
   assert len(calls)==1;expect(page.locator('#sendSms')).to_be_disabled()
  page.locator('#closeSms').click();expect(page.locator('#smsToken')).to_have_value('')
  page.locator('#queryDate').fill('2000-01-01');page.locator('#queryDate').dispatch_event('change');expect(page.locator('#smsButton')).to_be_disabled()
  assert not errors,errors
  c.close()
 b.close()
print('PASS: browser preview, unconfigured state, invalid recipient, missing auth, accepted/rejected results, empty query, cleared token; no real SMS sent')

