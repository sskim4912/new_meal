"""VIP 신규 신청/조회 분리와 PC·모바일 회귀. 운영 데이터 쓰기·문자 발송 없음."""
import os, json, csv, io
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect
from browser_support import mock_admin_auth

BASE = os.environ.get('AURORA_TEST_URL', 'http://127.0.0.1:8009')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1280, 'height':1000}, accept_downloads=True)
    mock_admin_auth(context)
    context.route('**/js/firebase-config.js', lambda r: r.fulfill(content_type='text/javascript', body='export const FIREBASE={enabled:false};'))
    records, writes, deletes = {}, [], []
    failures = {'delete':False, 'list':False, 'save':False}
    def api(route):
        body, path = route.request.post_data_json, route.request.url
        kind = 'list' if path.endswith('/vip/list') else 'save' if path.endswith('/vip/save') else 'delete'
        if failures[kind]:
            route.fulfill(status=503, content_type='application/json', body=json.dumps({'error':kind+' 테스트 오류'})); return
        if kind == 'list':
            data = {'rows':[row for row in records.values() if row['date']==body['date']]}
        elif kind == 'save':
            if any(row['name']=='홍길동' for row in body['rows']) and not body.get('confirmDuplicates'):
                data = {'duplicates':[{'date':body['rows'][0]['date'], 'name':'홍길동', 'group':'gs'}]}
            else:
                writes.append(body)
                for row in body['rows']: records[row['id']] = dict(row)
                data = {'saved':len(body['rows']), 'duplicates':[]}
        else:
            deletes.extend(body['ids'])
            for id in body['ids']: records.pop(id, None)
            data = {'deleted':len(body['ids'])}
        route.fulfill(content_type='application/json', body=json.dumps(data))
    context.route('**/vip/*', api)
    context.route('**/orders/delete', api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.clock.install(time=datetime(2026,10,16,0,30,tzinfo=timezone.utc))
    page.goto(BASE+'/index.html')
    page.locator('#tab-vip').click()
    login = page.locator('dialog[open]')
    expect(login.get_by_role('heading')).to_have_text('관리자 접근')
    login.locator('input').fill('230880'); login.locator('button.primary').click()
    expect(page.locator('#vipContent')).to_be_visible()
    expect(page.locator('#vipEmpty')).to_be_visible()
    expect(page.locator('#vipRows tbody tr')).to_have_count(0)
    expect(page.locator('#vipDraftRows tbody tr')).to_have_count(1)
    assert page.locator('[data-field="phone"]').count()==0
    def confirm(yes=True):
        page.locator('#confirmDialog button[value="yes"]' if yes else '#confirmDialog button[value="no"]').click()
    def submit(duplicate=False):
        page.locator('#vipSubmit').click(); confirm()
        if duplicate:
            expect(page.locator('#confirmTitle')).to_have_text('중복 신청 경고'); confirm()
    def fill_draft(index, company, name):
        row=page.locator('#vipDraftRows tbody tr').nth(index)
        row.locator('[data-field="company"]').fill(company)
        row.locator('[data-field="name"]').fill(name)
    page.locator('#vipOperator').fill('김담당')
    fill_draft(0,'본사','홍길동')
    page.locator('#vipDate').fill('2026-10-17'); page.locator('#vipDate').dispatch_event('change')
    expect(page.locator('#confirmTitle')).to_have_text('식사 날짜 변경'); confirm(False)
    expect(page.locator('#vipDate')).to_have_value('2026-10-16')
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('홍길동')
    page.locator('#vipAdd').click(); fill_draft(1,'VIP 기관','<img src=x onerror=alert(1)>')
    page.locator('#vipSubmit').click(); confirm()
    expect(page.locator('#confirmTitle')).to_have_text('중복 신청 경고')
    assert not writes
    confirm(False)
    expect(page.locator('#vipDraftRows tbody tr')).to_have_count(2)
    submit(True)
    expect(page.locator('#vipStatus')).to_contain_text('2건의 신청을 저장')
    expect(page.locator('#vipSummary')).to_have_text('2026-10-16 신청 내역 · 총 2명')
    expect(page.locator('#vipDraftRows tbody tr')).to_have_count(1)
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('')
    expect(page.locator('#vipOperator')).to_have_value('김담당')
    assert all(row['quantity']==1 and row['operatorName']=='김담당' and row['location']=='사무실' and row['meal']=='lunch' for row in records.values())
    assert page.locator('#vipRows img').count()==0
    assert page.locator('#vipRows [data-field]').count()==0 # Saved rows are text, not disabled input boxes.
    headers=page.locator('#vipRows th').all_text_contents()
    assert headers==['순번','소속','이름','중식메뉴','수량','대리입력자 이름','선택','작업'],headers
    # Editing an existing record does not discard a separate new draft.
    fill_draft(0,'작성 중 소속','새 신청 작성 중')
    first=page.locator('#vipRows tbody tr').first
    first.locator('[data-edit]').click(); first.locator('[data-field="company"]').fill('취소할 수정')
    first.locator('[data-cancel]').click()
    expect(first).to_contain_text('본사')
    assert first.locator('[data-field]').count()==0
    first.locator('[data-edit]').click(); first.locator('[data-field="company"]').fill('본사 수정')
    first.locator('[data-save]').click(); confirm()
    expect(page.locator('#confirmTitle')).to_have_text('중복 신청 경고'); confirm()
    expect(page.locator('#vipQueryStatus')).to_contain_text('1건의 신청을 수정')
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('새 신청 작성 중')
    # Querying another date affects only the list, never the draft or its date.
    page.locator('#vipQueryDate').fill('2026-10-20'); page.locator('#vipQueryDate').dispatch_event('change')
    expect(page.locator('#vipEmpty')).to_be_visible()
    expect(page.locator('#vipDate')).to_have_value('2026-10-16')
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('새 신청 작성 중')
    page.locator('#vipQueryDate').fill('2026-10-16'); page.locator('#vipQueryDate').dispatch_event('change')
    expect(page.locator('#vipRows tbody tr')).to_have_count(2)
    # Query failures cannot leave a stale actionable list behind.
    failures['list']=True; page.locator('#vipReload').click()
    expect(page.locator('#vipQueryStatus')).to_contain_text('불러오지 못했습니다')
    expect(page.locator('#vipRows tbody tr')).to_have_count(0)
    expect(page.locator('#vipDeleteSelected')).to_be_disabled()
    failures['list']=False; page.locator('#vipReload').click()
    expect(page.locator('#vipRows tbody tr')).to_have_count(2)
    # Small right-aligned checkboxes, selection count, delete cancel/failure retention.
    page.locator('#vipRows [data-select]').first.check()
    expect(page.locator('#vipSelectAll')).to_have_js_property('indeterminate',True)
    page.locator('#vipSelectAll').check()
    expect(page.locator('#vipSelectedCount')).to_have_text('선택 2건')
    page.locator('#vipDeleteSelected').click()
    expect(page.locator('#confirmText')).to_contain_text('2026-10-16 중식 신청 2건')
    confirm(False); assert len(records)==2 and not deletes
    failures['delete']=True
    page.locator('#vipDeleteSelected').click(); confirm()
    expect(page.locator('#vipQueryStatus')).to_contain_text('delete 테스트 오류')
    expect(page.locator('#vipSelectedCount')).to_have_text('선택 2건')
    failures['delete']=False
    page.locator('#vipRows [data-select]').nth(1).uncheck()
    page.locator('#vipDeleteSelected').click(); confirm()
    expect(page.locator('#vipRows tbody tr')).to_have_count(1)
    assert page.locator('#vipRows tbody tr').first.locator('td').first.inner_text()=='1'
    assert len(deletes)==1 and len(records)==1
    page.locator('#vipRows [data-remove]').click(); confirm()
    expect(page.locator('#vipEmpty')).to_be_visible()
    assert len(deletes)==2 and not records
    # New write failures retain all typed information; success resets only the new form.
    failures['save']=True; submit()
    expect(page.locator('#vipStatus')).to_contain_text('save 테스트 오류')
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('새 신청 작성 중')
    failures['save']=False; submit()
    expect(page.locator('#vipRows tbody tr')).to_have_count(1)
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('')
    assert len(records)==1
    # Exactly at cutoff all writes lock; lookup still works and remains independent.
    page.clock.set_fixed_time(datetime(2026,10,16,1,0,tzinfo=timezone.utc)); page.clock.fast_forward(1500)
    expect(page.locator('#vipOperator')).to_be_disabled()
    expect(page.locator('#vipSubmit')).to_be_disabled()
    expect(page.locator('#vipRows [data-edit]')).to_be_disabled()
    expect(page.locator('#vipSelectAll')).to_be_disabled()
    expect(page.locator('#vipReload')).to_be_enabled()
    page.locator('#vipDate').fill('2026-10-20'); page.locator('#vipDate').dispatch_event('change')
    expect(page.locator('#vipSubmit')).to_be_enabled()
    expect(page.locator('#vipQueryDate')).to_have_value('2026-10-16')
    expect(page.locator('#vipRows [data-edit]')).to_be_disabled()
    # A separate future-date order is deleted without affecting today's order.
    fill_draft(0,'본사','다른 날짜'); submit()
    expect(page.locator('#vipSummary')).to_have_text('2026-10-20 신청 내역 · 총 1명')
    page.locator('#vipSelectAll').check(); page.locator('#vipDeleteSelected').click(); confirm()
    expect(page.locator('#vipEmpty')).to_be_visible()
    assert len(records)==1 and all(row['date']=='2026-10-16' for row in records.values())
    # Admin aggregation and CSV still count one meal per name.
    page.goto(BASE+'/admin.html')
    page.evaluate('(rows)=>localStorage.setItem("aurora.v2.orders",JSON.stringify(rows))',list(records.values()))
    page.locator('#queryButton').click()
    expect(page.locator('#totalCards')).to_contain_text('총 1개')
    expect(page.locator('#detailTable')).to_contain_text('관리자 대리신청')
    with page.expect_download() as downloaded: page.locator('#csvButton').click()
    cells=list(csv.reader(io.StringIO(open(downloaded.value.path(),encoding='utf-8-sig').read())))
    assert len(cells[0])==11 and '신청 방식' in cells[0]
    assert '관리자 대리신청' in cells[1] and cells[1][-1]=='8,000'
    # Fresh late visit defaults to tomorrow. Use seeded mocks for desktop/mobile review.
    late=browser.new_context(viewport={'width':1280,'height':1000})
    mock_admin_auth(late); late.route('**/vip/*',api); late.route('**/orders/delete',api)
    for index,name in enumerate(['홍길동','이민수']):
        records['visual-'+str(index)]={**next(iter(records.values())), 'id':'visual-'+str(index), 'date':'2026-10-17','name':name,'company':'본사' if index==0 else '협력기관'}
    late_page=late.new_page(); late_page.on('pageerror',lambda error:errors.append(str(error)))
    late_page.clock.install(time=datetime(2026,10,16,1,0,tzinfo=timezone.utc))
    late_page.goto(BASE+'/vip.html')
    login=late_page.locator('dialog[open]');login.locator('input').fill('230880');login.locator('button.primary').click()
    expect(late_page.locator('#vipRows tbody tr')).to_have_count(2)
    expect(late_page.locator('#vipDate')).to_have_value('2026-10-17')
    late_page.locator('#vipOperator').press_sequentially('abcdefghijk')
    expect(late_page.locator('#vipOperator')).to_have_value('abcdefghij')
    late_page.locator('#vipDate').fill('2026-10-16');late_page.locator('#vipDate').dispatch_event('change')
    expect(late_page.locator('#vipOperator')).to_be_disabled()
    late_page.locator('#vipDate').fill('2026-10-17');late_page.locator('#vipDate').dispatch_event('change')
    late_page.locator('#vipOperator').fill('김성석')
    for width in [1440,1280,1024,900,820,768,430,390,360,320]:
        late_page.set_viewport_size({'width':width,'height':1000})
        assert late_page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        assert late_page.locator('.vip-selection-tools').evaluate('(el)=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return Math.abs(a.right-b.right)<2}'),width
        for selector in ['#vipSelectAll','#vipRows [data-select]']:
            assert late_page.locator(selector).first.evaluate('(el)=>el.offsetWidth===18&&el.offsetHeight===18'),(width,selector)
        assert late_page.locator('#vipDraftRows [data-field="name"]').evaluate('(el)=>el.getBoundingClientRect().width>=80'),width
        if width in [1280,390,360]:late_page.screenshot(path=f'/tmp/aurora-vip-layout-{width}.png',full_page=True)
    # Query discard confirmation only concerns saved-row edits and preserves new drafts.
    late_page.locator('#vipRows [data-edit]').first.click()
    late_page.locator('#vipRows [data-field="company"]').fill('취소 예정')
    late_page.locator('#vipQueryDate').fill('2026-10-18');late_page.locator('#vipQueryDate').dispatch_event('change')
    late_page.locator('#confirmDialog button[value="no"]').click()
    expect(late_page.locator('#vipQueryDate')).to_have_value('2026-10-17')
    expect(late_page.locator('#vipRows [data-field="company"]')).to_have_value('취소 예정')
    assert not errors,errors
    print('PASS: separate new/query workflows, multi-row save/reset, duplicate warning/cancel, edit/save/cancel, independent dates/drafts, failure retention, bulk/per-row deletion, cutoff, tomorrow default, aggregation/CSV, 10-character operator, 18px checkboxes and right alignment at 320–1440px; no real writes/SMS')
    browser.close()
