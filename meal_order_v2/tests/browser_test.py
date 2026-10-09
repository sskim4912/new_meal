"""실행: python3 tests/browser_test.py (서버 8000, Python Playwright + Chromium 필요)"""
import os
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
    page.locator('#detailTable [data-delete]').first.click()
    page.locator('#confirmDialog button[value="no"]').click()
    expect(page.locator('#detailTable tbody tr')).to_have_count(2)
    page.locator('#detailTable [data-delete]').first.click()
    page.locator('#confirmDialog button[value="yes"]').click()
    expect(page.locator('#totalCards')).to_contain_text('총 2개')
    page.locator('#detailSearch').fill('')
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
    assert not menu(extra,'breakfast').is_disabled()
    menu(extra,'breakfast').select_option('샌드위치(치킨텐더)')
    save(extra)
    extra.locator('#loadButton').click()
    expect(menu(extra,'breakfast')).to_have_value('샌드위치(치킨텐더)')
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
    browser.close()
    print('PASS: 신청자 3종, 메뉴/장소, 저장·수정·취소·불러오기, 확인 취소, 마감 재검증, 관리자 필터/집계/검색/삭제/초기화/CSV, 모바일 360/390/430px; 브라우저 오류 0')
