"""공통 메뉴, 미저장 확인, 서버 로그아웃, 홈 초기화 검증. 실제 서버 변경 없음."""
import os,json
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from browser_support import mock_admin_auth
BASE=os.environ.get('AURORA_TEST_URL','http://127.0.0.1:8000')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1280,'height':900})
    mock_admin_auth(context)
    context.route('**/js/firebase-config.js',lambda r:r.fulfill(content_type='text/javascript',body='export const FIREBASE={enabled:false};'))
    context.route('**/vip/list',lambda r:r.fulfill(content_type='application/json',body='{"rows":[]}'))
    page=context.new_page();errors=[];logouts=[];native_dialogs=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:logouts.append(r.url) if r.url.endswith('/auth/logout') else None)
    page.on('dialog',lambda d:(native_dialogs.append(d.type),d.accept()))
    page.clock.install(time=datetime(2026,10,16,0,0,tzinfo=timezone.utc))
    page.goto(BASE+'/index.html?start=new')
    expected=['직원 식사신청','중식 대리신청','관리자 집계']
    def check_nav(active):
        assert page.locator('.site-nav a').all_text_contents()==expected
        expect(page.locator('.site-nav [aria-current="page"]')).to_have_text(active)
    check_nav('직원 식사신청')
    expect(page.locator('#logoutButton')).to_be_hidden()
    profiles={'gs':{'group':'gs','empId':'KEEP-1','name':'기억할 이름'}}
    orders=[{'id':'keep-order','name':'보존할 신청'}]
    page.evaluate('([profiles,orders])=>{localStorage.setItem("aurora.v2.profiles",JSON.stringify(profiles));localStorage.setItem("aurora.v2.orders",JSON.stringify(orders));}',[profiles,orders])
    # Identity-only edits also need confirmation; cancel keeps the values.
    page.locator('[data-field="empId"]').fill('DRAFT-1')
    page.locator('[data-home]').click()
    expect(page.locator('#confirmDialog')).to_be_visible()
    page.locator('#confirmDialog button[value="no"]').click()
    expect(page.locator('[data-field="empId"]')).to_have_value('DRAFT-1')
    page.locator('[data-home]').click();page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('[data-field="empId"]')).to_have_value('')
    assert 'refresh=' in page.url and not logouts
    assert page.evaluate('JSON.parse(localStorage.getItem("aurora.v2.profiles"))')==profiles
    assert page.evaluate('JSON.parse(localStorage.getItem("aurora.v2.orders"))')==orders
    # Protected navigation prompts for login; regular page navigation keeps that session.
    page.get_by_role('link',name='중식 대리신청',exact=True).click()
    login=page.locator('dialog[open]');login.locator('input').fill('230880');login.locator('button.primary').click()
    expect(page.locator('#vipContent')).to_be_visible();check_nav('중식 대리신청')
    expect(page.locator('#logoutButton')).to_be_visible()
    page.locator('#vipOperator').fill('김담당')
    page.locator('#vipDraftRows [data-field="name"]').fill('작성 중')
    page.locator('[data-home]').click();page.locator('#confirmDialog button[value="no"]').click()
    assert not logouts
    expect(page.locator('#vipDraftRows [data-field="name"]')).to_have_value('작성 중')
    # Ordinary links confirm discard but do not log out.
    page.get_by_role('link',name='관리자 집계',exact=True).click()
    page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#adminContent')).to_be_visible();check_nav('관리자 집계')
    assert not logouts
    # Same menu order, sizing, active state and no page overflow across screens/widths.
    for target,label in [('index.html?start=new','직원 식사신청'),('vip.html','중식 대리신청'),('admin.html','관리자 집계')]:
        page.goto(BASE+'/'+target);check_nav(label)
        if target=='vip.html':expect(page.locator('#vipContent')).to_be_visible()
        if target=='admin.html':expect(page.locator('#adminContent')).to_be_visible()
        expect(page.locator('#logoutButton')).to_be_visible()
        for width in [1440,1280,1024,960,820,430,390,360,320]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(target,width)
            sizes=page.locator('.site-nav a').evaluate_all('(links)=>links.map(el=>getComputedStyle(el).fontSize)')
            assert len(set(sizes))==1,(target,width,sizes)
            if width in [1280,390]:page.screenshot(path='/tmp/aurora-navigation-'+target.split('.')[0]+f'-{width}.png',full_page=True)
    page.locator('[data-home]').click()
    expect(page.locator('[data-field="empId"]')).to_have_value('')
    assert len(logouts)==1
    assert page.evaluate('sessionStorage.getItem("aurora.admin.session.v1")') is None
    expect(page.locator('#logoutButton')).to_be_hidden()
    assert page.evaluate('JSON.parse(localStorage.getItem("aurora.v2.profiles"))')==profiles
    assert page.evaluate('JSON.parse(localStorage.getItem("aurora.v2.orders"))')==orders
    page.get_by_role('link',name='관리자 집계',exact=True).click()
    expect(page.locator('#passwordDialog')).to_be_visible()
    page.locator('#password').fill('230880');page.locator('#passwordForm .primary').click()
    expect(page.locator('#adminContent')).to_be_visible()
    page.locator('#logoutButton').click()
    expect(page.locator('[data-field="empId"]')).to_have_value('')
    assert len(logouts)==2
    # A logo click cannot interrupt an in-flight save; after failure, confirm once and leave.
    page.get_by_role('link',name='중식 대리신청',exact=True).click()
    login=page.locator('dialog[open]');login.locator('input').fill('230880');login.locator('button.primary').click()
    expect(page.locator('#vipContent')).to_be_visible()
    page.locator('#vipOperator').fill('김담당')
    page.locator('#vipDraftRows [data-field="company"]').fill('본사')
    page.locator('#vipDraftRows [data-field="name"]').fill('미저장 이름')
    held=[]
    context.route('**/vip/save',lambda route:held.append(route))
    page.locator('#vipSubmit').click();page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#vipSubmit')).to_be_disabled()
    page.locator('[data-home]').click()
    expect(page.locator('#navigationStatus')).to_contain_text('처리 중')
    assert len(logouts)==2
    assert len(held)==1
    held[0].fulfill(status=503,content_type='application/json',body='{"error":"저장 테스트 오류"}')
    expect(page.locator('#vipStatus')).to_contain_text('저장 테스트 오류')
    page.locator('[data-home]').click();page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('[data-field="empId"]')).to_have_value('')
    assert len(logouts)==3
    assert page.evaluate('sessionStorage.getItem("aurora.admin.session.v1")') is None
    assert not native_dialogs,native_dialogs
    assert not errors,errors
    print('PASS: shared navigation order/active state at 320–1440px, login/session reuse, identity/VIP discard confirmation and cancel, logo/button server logout, fresh employee home, remembered profiles/orders preserved, no duplicate native prompts; mocked services only')
    browser.close()
