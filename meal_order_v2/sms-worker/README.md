# 관리자·문자 발송 Worker

관리자 비밀번호 하나로 로그인하고 발급된 8시간 세션으로 VIP 대리신청과 문자 발송을 처리합니다. 문자 인증키를 화면에 입력하지 않습니다.

배포·Secret·Firebase 관리자 계정·권한 문서 설정은 [ADMIN-V2-DEPLOY.md](../ADMIN-V2-DEPLOY.md)를 따르세요.

기존 SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_FROM_NUMBER / ALLOWED_ORIGIN을 유지하고 ADMIN_PASSWORD / FIREBASE_ADMIN_EMAIL / FIREBASE_ADMIN_PASSWORD를 Secret으로 추가합니다. 서비스 계정 JSON은 사용하지 않습니다.

wrangler.toml의 REQUESTS/SmsRequest와 ADMIN/AdminState 바인딩, v1/v2 migrations를 모두 배포해야 합니다. 원래 workers.dev 주소를 유지합니다.

POST /auth/login, /auth/verify, /auth/logout, /vip/list, /vip/save, /orders/delete, /reports/preview, /send를 제공합니다. /auth/login 외에는 서버 세션이 필요합니다. Origin은 허용된 GitHub Pages 출처만 받습니다. Worker URL을 직접 열 때는 출처 오류가 정상입니다.

중식 1차 집계는 솔라피 접수 후 Durable Object에 저장되며 최종 집계의 비교 기준입니다. 발송 요청 ID로 중복 접수를 방지하며 결과 불명 시 자동 재발송하지 않습니다. 미리보기는 5분간 유효합니다. 자동 발송 일정은 등록하지 않습니다.

관리자 전용 Firebase 계정은 관리자 권한 문서가 존재해야 대리신청을 쓸 수 있고 Firebase 규칙도 10시 마감을 검증합니다. 모든 새 대리신청에는 source=admin-proxy, quantity=1이 기록됩니다. 비밀번호와 비밀값은 로그·GitHub·채팅에 넣지 않습니다.
