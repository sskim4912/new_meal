import os,json,csv,io
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from browser_support import mock_admin_auth
BASE=os.environ.get('AURORA_TEST_URL','http://127.0.0.1:8009')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=b.new_context(viewport={'width':390,'height':850},accept_downloads=True)
 mock_admin_auth(c)
 c.route('**/js/firebase-config.js',lambda r:r.fulfill(content_type='text/javascript',body='export const FIREBASE={enabled:false};'))
 records={};writes=[];deletes=[];delete_fail=False
 def api(route):
  body=route.request.post_data_json;path=route.request.url
  if path.endswith('/vip/list'):data={'rows':[row for row in records.values() if row['date']==body['date']]}
  elif path.endswith('/vip/save'):
   if any(row['name']=='홍길동' for row in body['rows']) and not body.get('confirmDuplicates'):data={'duplicates':[{'date':body['rows'][0]['date'],'name':'홍길동','group':'gs'}]}
   else:
    writes.append(body)
    for row in body['rows']:records[row['id']]={**{key:value for key,value in row.items() if key not in ['fresh','changed']},'source':'admin-proxy','quantity':1}
    data={'saved':len(body['rows']),'duplicates':[]}
  else:
   if delete_fail:
    route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':'삭제 테스트 오류'}));return
   deletes.extend(body['ids'])
   for id in body['ids']:records.pop(id,None)
   data={'deleted':len(body['ids'])}
  route.fulfill(content_type='application/json',body=json.dumps(data))
 c.route('**/vip/*',api);c.route('**/orders/delete',api)
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.install(time=datetime(2026,10,16,0,30,tzinfo=timezone.utc))
 page.goto(BASE+'/index.html')
 page.locator('#tab-vip').click()
 login=page.locator('dialog[open]')
 expect(login.get_by_role('heading')).to_have_text('관리자 접근')
 login.locator('input').fill('230880');login.locator('button.primary').click()
 expect(page.locator('#vipContent')).to_be_visible()
 assert page.locator('[data-field="phone"]').count()==0
 page.locator('#vipOperator').fill('김담당')
 first=page.locator('#vipRows tbody tr').first
 first.locator('[data-field="company"]').fill('본사')
 first.locator('[data-field="name"]').fill('홍길동')
 page.locator('#vipAdd').click()
 second=page.locator('#vipRows tbody tr').nth(1)
 second.locator('[data-field="company"]').fill('VIP 기관')
 second.locator('[data-field="name"]').fill('<img src=x onerror=alert(1)>')
 page.locator('#vipSubmit').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#confirmTitle')).to_have_text('중복 신청 경고')
 assert not writes
 page.locator('#confirmDialog button[value="no"]').click()
 expect(page.locator('#vipRows tbody tr')).to_have_count(2)
 page.locator('#vipSubmit').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#confirmTitle')).to_have_text('중복 신청 경고')
 page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipStatus')).to_contain_text('2건')
 assert len(records)==2
 assert all(row['operatorName']=='김담당' for row in records.values())
 assert all(row['quantity']==1 and row['location']=='사무실' and row['meal']=='lunch' for row in records.values())
 assert page.locator('#vipRows img').count()==0
 first=page.locator('#vipRows tbody tr').first
 expect(first.locator('[data-field="company"]')).to_be_disabled()
 first.locator('[data-edit]').click()
 first.locator('[data-field="company"]').fill('취소할 수정')
 first.locator('[data-cancel]').click()
 expect(first.locator('[data-field="company"]')).to_have_value('본사')
 first.locator('[data-edit]').click()
 first.locator('[data-field="company"]').fill('본사 수정')
 first.locator('[data-save]').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#confirmTitle')).to_have_text('중복 신청 경고');page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipStatus')).to_contain_text('1건')
 assert len(records)==2
 page.locator('#vipRows [data-remove]').first.click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipStatus')).to_contain_text('삭제했습니다')
 assert len(records)==1 and len(deletes)==1
 # Bulk deletion: cancel, error retention, mixed saved/draft rows, and renumbering.
 page.locator('#vipReload').click()
 expect(page.locator('#vipRows [data-field="operatorName"]').first).to_have_value('김담당')
 page.locator('#vipAdd').click()
 page.locator('#vipRows [data-select]').first.check()
 expect(page.locator('#vipSelectAll')).to_have_js_property('indeterminate',True)
 page.locator('#vipSelectAll').check()
 expect(page.locator('#vipSelectedCount')).to_have_text('선택 2건')
 page.locator('#vipDeleteSelected').click()
 expect(page.locator('#confirmText')).to_contain_text('2026-10-16 중식 신청 2건')
 page.locator('#confirmDialog button[value="no"]').click()
 assert len(records)==1 and len(deletes)==1
 delete_fail=True
 page.locator('#vipDeleteSelected').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipStatus')).to_contain_text('삭제 테스트 오류')
 expect(page.locator('#vipSelectedCount')).to_have_text('선택 2건')
 expect(page.locator('#vipRows tbody tr')).to_have_count(2)
 delete_fail=False
 # Deselect the draft so only the saved row is removed, then remove draft locally.
 page.locator('#vipRows [data-select]').nth(1).uncheck()
 page.locator('#vipDeleteSelected').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipRows tbody tr')).to_have_count(1)
 assert page.locator('#vipRows tbody tr').first.locator('td').nth(1).inner_text()=='1'
 assert len(records)==0 and len(deletes)==2
 page.locator('#vipSelectAll').check()
 page.locator('#vipDeleteSelected').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipRows tbody tr')).to_have_count(0)
 assert len(deletes)==2 # No server request for an unsaved row.
 # Restore a representative order for aggregation, and keep selection date-scoped.
 page.locator('#vipAdd').click()
 first=page.locator('#vipRows tbody tr').first
 first.locator('[data-field="company"]').fill('본사')
 first.locator('[data-field="name"]').fill('집계 확인')
 page.locator('#vipSubmit').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipStatus')).to_contain_text('1건')
 page.locator('#vipSelectAll').check()
 # 자정/10시 기준은 서버 테스트와 함께 확인하며 화면도 10시에 잠깁니다.
 page.clock.set_fixed_time(datetime(2026,10,16,1,0,tzinfo=timezone.utc));page.clock.fast_forward(31000)
 expect(page.locator('#vipSubmit')).to_be_disabled()
 expect(page.locator('#vipDeleteSelected')).to_be_disabled()
 expect(page.locator('#vipOperator')).to_be_enabled()
 page.locator('#vipDate').fill('2026-10-20');page.locator('#vipDate').dispatch_event('change')
 expect(page.locator('#vipSubmit')).to_be_enabled()
 expect(page.locator('#vipSelectedCount')).to_have_text('선택 0건')
 expect(page.locator('#vipSelectAll')).not_to_be_checked()
 # Selecting all on a different date removes only that date, including its draft.
 first=page.locator('#vipRows tbody tr').first
 first.locator('[data-field="company"]').fill('본사')
 first.locator('[data-field="name"]').fill('다른 날짜')
 page.locator('#vipSubmit').click();page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipStatus')).to_contain_text('1건')
 page.locator('#vipAdd').click();page.locator('#vipSelectAll').check()
 page.locator('#vipDeleteSelected').click()
 expect(page.locator('#confirmText')).to_contain_text('2026-10-20 중식 신청 2건')
 page.locator('#confirmDialog button[value="yes"]').click()
 expect(page.locator('#vipRows tbody tr')).to_have_count(0)
 assert len(records)==1 and all(row['date']=='2026-10-16' for row in records.values())
 for width in [360,390,430,1120]:
  page.set_viewport_size({'width':width,'height':850});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.goto(BASE+'/admin.html')
 page.evaluate('(rows)=>localStorage.setItem("aurora.v2.orders",JSON.stringify(rows))',list(records.values()))
 page.locator('#queryButton').click()
 expect(page.locator('#totalCards')).to_contain_text('총 1개')
 expect(page.locator('#detailTable')).to_contain_text('관리자 대리신청')
 with page.expect_download() as downloaded:page.locator('#csvButton').click()
 cells=list(csv.reader(io.StringIO(open(downloaded.value.path(),encoding='utf-8-sig').read())))
 assert len(cells[0])==11 and '신청 방식' in cells[0]
 assert '관리자 대리신청' in cells[1] and cells[1][-1]=='8,000'
 assert not errors,errors
 print('PASS: operator persistence, row edit/save/cancel, bulk selection/cancel/delete/error retention, draft removal, renumbering, date-scoped selection, quantity 1, duplicate warning, 10:00 lock, admin aggregation/CSV and mobile layout; no real writes/SMS')
 # A new visit after today's cutoff must start on tomorrow, with an editable operator.
 late=b.new_context(viewport={'width':1120,'height':900})
 mock_admin_auth(late)
 late.route('**/vip/*',api)
 late_page=late.new_page()
 late_page.clock.install(time=datetime(2026,10,16,1,0,tzinfo=timezone.utc))
 late_page.goto(BASE+'/vip.html')
 late_login=late_page.locator('dialog[open]')
 late_login.locator('input').fill('230880');late_login.locator('button.primary').click()
 expect(late_page.locator('#vipContent')).to_be_visible()
 expect(late_page.locator('#vipDate')).to_have_value('2026-10-17')
 expect(late_page.locator('#vipOperator')).to_be_enabled()
 late_page.locator('#vipDate').fill('2026-10-16');late_page.locator('#vipDate').dispatch_event('change')
 expect(late_page.locator('#vipSubmit')).to_be_disabled()
 expect(late_page.locator('#vipOperator')).to_be_enabled()
 late_page.locator('#vipOperator').press_sequentially('abcdefghijk')
 expect(late_page.locator('#vipOperator')).to_have_value('abcdefghij')
 late_page.locator('#vipDate').fill('2026-10-17');late_page.locator('#vipDate').dispatch_event('change')
 expect(late_page.locator('#vipRows [data-field="operatorName"]').first).to_have_value('abcdefghij')
 expect(late_page.locator('#vipSubmit')).to_be_enabled()
 for width in [1120,820,430,390,360]:
  late_page.set_viewport_size({'width':width,'height':900})
  bounds=late_page.locator('.vip-fields input').evaluate_all('(inputs)=>inputs.map(input=>({width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height,top:input.getBoundingClientRect().top}))')
  assert all(item['width']<=170 and item['height']<=40 for item in bounds),bounds
  if width<=820:assert bounds[0]['top']==bounds[1]['top'] and bounds[2]['top']==bounds[3]['top'],bounds
  assert late_page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 late_page.screenshot(path='/tmp/aurora-vip-compact-360.png',full_page=True)
 print('PASS: operator editable after cutoff, tomorrow default, 10-character limit, operator carried to new date, compact four-field layout at desktop/mobile widths')
 late.close()
 b.close()
