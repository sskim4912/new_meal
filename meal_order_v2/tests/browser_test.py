"""실행: python3 tests/browser_test.py (서버 8000, Python Playwright + Chromium 필요)"""
import os
import csv
import io
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('AURORA_TEST_URL', 'http://127.0.0.1:8000')
DATE = '2026-10-05'

def menu(page, meal):
    return page.locator(f'#menu-{DATE}-{meal}')

def save(page, cancel=False):
    page.locator('#submitButton').click()
    expect(page.locator('#confirmDialog')).to_be_visible()
    page.locator('#confirmDialog button[value="no"]' if cancel else '#confirmDialog button[value="yes"]').click()
    if not cancel:
        expect(page.locator('#successDialog')).to_be_visible()
        page.locator('#successDialog button').click()

def login(page):
    page.goto(BASE + '/admin.html')
    page.locator('#password').fill('wrong')
    page.locator('#passwordForm button[type="button"] + button').click()
    expect(page.locator('#passwordError')).to_contain_text('확인')
    page.locator('#password').fill('230880')
    page.locator('#passwordForm button[type="button"] + button').click()
    expect(page.locator('#adminContent')).to_be_visible()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1120,'height':900}, accept_downloads=True)
    context.route('**/js/firebase-config.js', lambda route: route.fulfill(content_type='text/javascript',body="export const FIREBASE = { enabled: false };"))
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.clock.install(time=datetime(2026,10,4,23,0,tzinfo=timezone.utc)) # 월요일 KST 08:00
    page.goto(BASE)
    expect(page.locator('.day')).to_have_count(6)
    assert menu(page,'breakfast').is_disabled()
    assert not menu(page,'lunch').is_disabled()
    assert menu(page,'lunch').locator('option').all_text_contents()==['신청 안 함','백반']
    assert '백반' not in menu(page,'breakfast').locator('option').all_text_contents()
    assert '백반' not in menu(page,'dinner').locator('option').all_text_contents()
    page.locator('[data-field="empId"]').fill('A-123')
    page.locator('[data-field="name"]').fill('홍길동')
    page.locator('#remember').check()
    menu(page,'lunch').select_option('백반')
    assert page.locator('[data-location] option').all_text_contents()==['사무실','OSBL','ISBL']
    expect(page.locator('[data-location]')).to_have_value('사무실')
    page.locator('[data-location]').select_option('OSBL')
    menu(page,'dinner').select_option('볶음밥(김치)')
    expect(page.locator('#changeCount')).to_contain_text('2건')
    save(page,True)
    assert page.evaluate("localStorage.getItem('aurora.v2.orders')") is None
    save(page)
    expect(page.locator('#saveStatus')).to_contain_text('2건 저장 완료')
    page.reload()
    expect(page.locator('[data-field="empId"]')).to_have_value('A-123')
    page.locator('#loadButton').click()
    expect(menu(page,'lunch')).to_have_value('백반')
    expect(page.locator('[data-location]')).to_have_value('OSBL')
    menu(page,'dinner').select_option('샐러드(닭가슴살)')
    save(page)
    menu(page,'lunch').select_option('신청 안 함')
    expect(page.locator('[data-location]')).to_have_count(0)
    save(page)
    page.locator('#nextWeek').click()
    page.locator('#prevWeek').click()
    expect(menu(page,'dinner')).to_have_value('샐러드(닭가슴살)')
    for group, name, location in [('partner','협력사 신청자','ISBL'),('vip','<img src=x onerror=alert(1)>','사무실')]:
        page.locator('#tab-'+group).click()
        page.locator('[data-field="company"]').fill('회사 '+group)
        page.locator('[data-field="name"]').fill(name)
        page.locator('[data-field="phone"]').fill('123')
        page.locator('#loadButton').click()
        expect(page.locator('#employeeStatus')).to_contain_text('연락처')
        page.locator('[data-field="phone"]').fill('010-1234-5678')
        menu(page,'lunch').select_option('백반')
        page.locator('[data-location]').select_option(location)
        save(page)
        page.locator('#loadButton').click()
        expect(menu(page,'lunch')).to_have_value('백반')
    assert page.locator('#successDialog img').count()==0
    # 3개 실제 신청 + 1개 신청 안 함. 기본정보와 신청은 별도 저장.
    assert len(page.evaluate("JSON.parse(localStorage.getItem('aurora.v2.orders'))"))==4
    login(page)
    expect(page.locator('#totalCards')).to_contain_text('총 3개')
    expect(page.locator('#totalCards')).to_contain_text('25,000원')
    expect(page.locator('#groupedTable')).to_contain_text('ISBL')
    expect(page.locator('#subtotalTable')).to_contain_text('메뉴별')
    for group in ['gs','partner','vip']:
        page.locator('#queryGroup').select_option(group)
        expect(page.locator('#totalCards')).to_contain_text('총 1개')
    page.locator('#queryGroup').select_option('all')
    page.locator('#viewMode').select_option('month')
    expect(page.locator('#dailyPanel')).to_be_visible()
    expect(page.locator('#dailyTable')).to_contain_text('25,000원')
    page.locator('#detailSearch').fill('A-123')
    expect(page.locator('#detailTable tbody tr')).to_have_count(2)
    expect(page.locator('#totalCards')).to_contain_text('총 3개')
    with page.expect_download() as download:
        page.locator('#csvButton').click()
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/'orders.csv'; download.value.save_as(path)
        raw=path.read_bytes(); assert raw.startswith(b'\xef\xbb\xbf')
        text=raw.decode('utf-8-sig'); assert '협력사 신청자' in text and '신청 안 함' not in text
        assert len(text.splitlines())==4
        cells=list(csv.reader(io.StringIO(text)))
        assert cells[0][-2:]==['단가','금액']
        assert all(len(row)==10 for row in cells)
        assert all(row[-1] in ['8,000','9,000'] and row[-2]==row[-1] for row in cells[1:])
    page.locator('#detailTable [data-delete]').first.click()
    page.locator('#confirmDialog button[value="no"]').click()
    expect(page.locator('#detailTable tbody tr')).to_have_count(2)
    page.locator('#detailTable [data-delete]').first.click()
    page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#totalCards')).to_contain_text('총 2개')
    page.locator('#detailSearch').fill('')
    # 별도 컨텍스트에서 선택 삭제를 검증하여 기존 회귀 검사의 주문을 유지합니다.
    bulk_context=browser.new_context(viewport={'width':390,'height':850})
    bulk_context.route('**/js/firebase-config.js',lambda route:route.fulfill(content_type='text/javascript',body="export const FIREBASE = { enabled: false };"))
    bulk=bulk_context.new_page()
    bulk.clock.install(time=datetime(2026,10,4,23,0,tzinfo=timezone.utc))
    bulk.goto(BASE)
    bulk.evaluate('(rows)=>localStorage.setItem("aurora.v2.orders",JSON.stringify(rows))',page.evaluate("JSON.parse(localStorage.getItem('aurora.v2.orders'))"))
    login(bulk)
    expect(bulk.locator('[data-select]')).to_have_count(3)
    assert bulk.locator('#deleteSelected').is_disabled()
    bulk.locator('[data-select]').first.check()
    assert bulk.locator('#selectAllDetails').evaluate('(el)=>el.indeterminate')
    expect(bulk.locator('#deleteSelected')).to_have_text('선택 삭제 (1건)')
    bulk.locator('#deleteSelected').click()
    expect(bulk.locator('#confirmText')).to_contain_text('1건')
    bulk.locator('#confirmDialog button[value="no"]').click()
    assert len(bulk.evaluate("JSON.parse(localStorage.getItem('aurora.v2.orders'))"))==3
    bulk.locator('#deleteSelected').click()
    bulk.locator('#confirmDialog button[value="yes"]').click()
    expect(bulk.locator('#detailTable tbody tr')).to_have_count(2)
    assert bulk.locator('#deleteSelected').is_disabled()
    # 검색으로 숨겨진 행은 선택에서 제외되고 삭제되지 않습니다.
    bulk.locator('#selectAllDetails').check()
    bulk.locator('#detailSearch').fill('협력사 신청자')
    expect(bulk.locator('#detailTable tbody tr')).to_have_count(1)
    expect(bulk.locator('#deleteSelected')).to_have_text('선택 삭제 (1건)')
    bulk.locator('#selectAllDetails').uncheck()
    assert bulk.locator('#deleteSelected').is_disabled()
    bulk.locator('#selectAllDetails').check()
    bulk.locator('#deleteSelected').click()
    bulk.locator('#confirmDialog button[value="yes"]').click()
    expect(bulk.locator('#detailTable .empty')).to_be_visible()
    assert len(bulk.evaluate("JSON.parse(localStorage.getItem('aurora.v2.orders'))"))==1
    bulk.locator('#detailSearch').fill('')
    expect(bulk.locator('#detailTable tbody tr')).to_have_count(1)
    assert bulk.evaluate('document.documentElement.scrollWidth <= innerWidth')
    bulk_context.close()
    for width in [360,390,430]:
        page.set_viewport_size({'width':width,'height':850})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.goto(BASE)
        expect(page.locator('.day')).to_have_count(6)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('.day').first.bounding_box()['width'] > width-50
        assert page.locator('#submitButton').bounding_box()['height'] >=44
        page.screenshot(path=f'/tmp/aurora-employee-{width}.png',full_page=True)
        login(page)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#resetAll').click()
    page.locator('#confirmDialog button[value="no"]').click()
    expect(page.locator('#totalCards')).to_contain_text('총 2개')
    page.locator('#resetAll').click()
    page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#totalCards')).to_contain_text('총 0개')
    assert page.evaluate("JSON.parse(localStorage.getItem('aurora.v2.profiles')).gs.empId")=='A-123'
    page.locator('#logoutButton').click()
    expect(page.locator('#adminContent')).to_be_hidden()
    # 관리자에서 직원 화면으로 돌아오면 기억된 정보와 무관하게 처음부터 입력합니다.
    page.get_by_role('link', name='직원 화면').click()
    expect(page.locator('[data-field="empId"]')).to_have_value('')
    expect(page.locator('[data-field="name"]')).to_have_value('')
    expect(page.locator('[data-field="empId"]')).to_be_focused()
    expect(page.locator('#remember')).not_to_be_checked()
    expect(page.locator('.day')).to_have_count(6)
    expect(page.locator('#changeCount')).to_contain_text('0건')
    assert all(value == '신청 안 함' for value in page.locator('#days select').evaluate_all('(elements) => elements.map(el => el.value)'))
    assert page.evaluate("JSON.parse(localStorage.getItem('aurora.v2.profiles')).gs.empId") == 'A-123'
    page.reload()
    expect(page.locator('[data-field="empId"]')).to_have_value('')
    # 확인 모달이 열린 사이 마감: 저장 거부
    page.goto(BASE)
    page.locator('#nextWeek').click()
    next_lunch=page.locator('#menu-2026-10-12-lunch')
    next_lunch.select_option('백반')
    page.locator('#submitButton').click()
    page.clock.set_fixed_time(datetime(2026,10,12,0,0,tzinfo=timezone.utc))
    page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#saveStatus')).to_contain_text('마감')
    assert page.evaluate("localStorage.getItem('aurora.v2.orders')") is None
    assert next_lunch.is_disabled()
    assert not errors, errors
    # 별도 컨텍스트에서 조식 저장 및 저장 공간 오류를 검증합니다.
    isolated = browser.new_context()
    isolated.route('**/js/firebase-config.js', lambda route: route.fulfill(content_type='text/javascript',body="export const FIREBASE = { enabled: false };"))
    extra = isolated.new_page()
    extra.clock.install(time=datetime(2026,10,4,0,0,tzinfo=timezone.utc))
    extra.goto(BASE)
    extra.locator('#nextWeek').click()
    extra.locator('[data-field="empId"]').fill('B-1')
    extra.locator('[data-field="name"]').fill('조식 신청자')
    assert menu(extra,'breakfast').is_disabled()
    breakfast = extra.locator('#menu-2026-10-06-breakfast')
    assert not breakfast.is_disabled()
    breakfast.select_option('샌드위치(치킨텐더)')
    save(extra)
    extra.locator('#loadButton').click()
    expect(breakfast).to_have_value('샌드위치(치킨텐더)')
    menu(extra,'dinner').select_option('볶음밥(중국식)')
    extra.evaluate("() => { Storage.prototype.setItem = function(){throw new DOMException('quota', 'QuotaExceededError')}; }")
    extra.locator('#submitButton').click()
    extra.locator('#confirmDialog button[value="yes"]').click()
    expect(extra.locator('#saveStatus')).to_contain_text('저장하지 못했습니다')
    expect(extra.locator('#changeCount')).to_contain_text('1건')
    assert len(extra.evaluate("JSON.parse(localStorage.getItem('aurora.v2.orders'))"))==1
    extra.reload()
    extra.evaluate("localStorage.setItem('aurora.v2.orders', 'invalid-json')")
    extra.locator('[data-field="empId"]').fill('B-1')
    extra.locator('[data-field="name"]').fill('조식 신청자')
    extra.locator('#loadButton').click()
    expect(extra.locator('#employeeStatus')).to_contain_text('저장 공간')
    isolated.close()
    # 공휴일 색상·대체공휴일 이름과 모바일 인사 문구를 별도 화면에서 검사합니다.
    calendar_context=browser.new_context(viewport={'width':390,'height':850})
    calendar_context.route('**/js/firebase-config.js',lambda route:route.fulfill(content_type='text/javascript',body="export const FIREBASE = { enabled: false };"))
    calendar=calendar_context.new_page()
    calendar.clock.install(time=datetime(2027,1,1,0,0,tzinfo=timezone.utc))
    calendar.goto(BASE)
    def card(date):
        return calendar.locator(f'.day:has(#menu-{date}-lunch)')
    expect(card('2027-01-01').locator('.holiday-name')).to_have_text('신정')
    assert card('2027-01-01').locator('.day-head span').evaluate('(el)=>getComputedStyle(el).color')=='rgb(174, 52, 52)'
    assert card('2027-01-01').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 241, 241)'
    assert card('2027-01-02').locator('.holiday-name').count()==0
    assert card('2027-01-02').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 255, 255)'
    calendar.locator('#prevWeek').click()
    expect(card('2026-12-25').locator('.holiday-name')).to_have_text('성탄절')
    assert card('2026-12-25').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 241, 241)'
    assert card('2026-12-24').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 255, 255)'
    calendar.screenshot(path='/tmp/aurora-holidays-2026.png',full_page=True)
    calendar.locator('#nextWeek').click()
    expect(calendar.locator('#weeklyGreeting')).to_contain_text('이번 주')
    for width in [360,390,430]:
        calendar.set_viewport_size({'width':width,'height':850})
        assert calendar.evaluate('document.documentElement.scrollWidth <= innerWidth')
    calendar.evaluate("for(let i=0;i<18;i++)document.getElementById('nextWeek').click()")
    expect(calendar.locator('#weekLabel')).to_contain_text('2027.05.03')
    expect(card('2027-05-03').locator('.holiday-name')).to_have_text('노동절 대체공휴일')
    assert card('2027-05-03').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 241, 241)'
    expect(card('2027-05-05').locator('.holiday-name')).to_have_text('어린이날')
    assert card('2027-05-04').locator('.holiday-name').count()==0
    calendar_context.close()
    browser.close()
    print('PASS: 신청자 3종, 메뉴/장소, 저장·수정·취소·불러오기, 확인 취소, 마감 재검증, 관리자 필터/집계/검색/삭제/초기화/CSV, 모바일 360/390/430px; 브라우저 오류 0')
