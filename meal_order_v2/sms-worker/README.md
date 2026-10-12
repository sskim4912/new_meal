# 솔라피 문자 발송 서버 설정

공개 HTML에 있던 이전 솔라피 API 키는 폐기하고 새 키를 발급하세요. 키 값을 GitHub 파일이나 채팅에 넣지 마세요.
이 서버는 관리자 화면의 정적 비밀번호 대신 별도의 서버 인증키로 실제 발송을 보호합니다.

## Cloudflare 화면에서 배포

1. Cloudflare 대시보드 → **Workers & Pages** → **Create application** → GitHub 저장소 가져오기(Import a repository).
2. `sskim4912/new_meal` 선택. Worker 이름: `new-meal-sms`.
3. 고급 설정의 Root directory: `meal_order_v2/sms-worker`.
4. Build command는 비워 두고 Deploy command: `npx wrangler deploy`.
5. 배포 후 Worker → **Settings → Variables and Secrets → Add**에서 아래 4개를 **Secret** 유형으로 등록하고 적용합니다.

| 이름 | 입력할 값 |
|---|---|
| SOLAPI_API_KEY | 새로 발급한 솔라피 API 키 |
| SOLAPI_API_SECRET | 새 키의 시크릿 |
| SOLAPI_FROM_NUMBER | 솔라피에 등록·인증된 발신번호(하이픈 없이) |
| SMS_ADMIN_TOKEN | 무작위로 만든 긴 문자 발송 전용 인증키(32자 이상 필수) |

발송 인증키는 관리자만 보관합니다. 화면의 관리자 비밀번호를 재사용하지 마세요.
`ALLOWED_ORIGIN`은 wrangler.toml에 `https://sskim4912.github.io`로 설정되어 있습니다.
Durable Object 바인딩과 migration은 같은 파일을 통해 배포됩니다. 일반 정적 Pages로 배포하지 마세요.

## 관리자 화면 연결

1. 배포된 Worker 주소 확인: `https://new-meal-sms.<계정 하위도메인>.workers.dev`.
2. `meal_order_v2/js/sms-config.js`의 endpoint에 해당 주소 + `/send`를 입력합니다.
3. GitHub main에 저장해 Pages 배포가 끝난 뒤 관리자 화면을 새로고침합니다.
4. 관리자 로그인 때 `SMS_ADMIN_TOKEN`을 한 번 입력 → 조회 → **집계 문자 발송** → 수신번호·미리보기 확인 → 발송.
5. 솔라피 발송 내역에서 최종 전달 여부를 확인합니다. '접수'는 최종 수신 완료가 아닙니다.

사이트는 수신번호와 인증키를 브라우저 저장소에 저장하지 않습니다. 인증키는 로그인 중 메모리에서만 사용하고, 관리자 잠금 또는 새로고침 시 지웁니다. 발송 모달에는 인증키 입력칸이 없습니다.
발송 내용에는 현재 조회 범위의 집계만 포함하고 신청자 이름·사번은 제외합니다.
2000 UTF-8 바이트를 넘으면 범위를 줄이도록 안내합니다. 자동 분할 발송은 하지 않습니다.
같은 화면 세션에서 동일 수신번호·내용은 요청 번호를 재사용합니다. 서버는 동일 요청 번호의 접수를 재실행하지 않습니다.
시간초과 등 결과가 불확실하면 자동 재발송하지 말고 솔라피 발송 내역을 먼저 확인하세요.
새로고침 후 새 발송 요청을 만드는 경우는 별개 요청이므로 운영자가 중복 발송 여부를 확인해야 합니다.

## 로컬 검증

저장소 루트에서 `node --test meal_order_v2/tests/sms.test.mjs`.
테스트는 가짜 응답만 사용하고 실제 솔라피 발송을 하지 않습니다.
실제 운영 준비 완료 판정에는 Worker 배포, 새 솔라피 키·등록 발신번호·잔액, 수신자 동의 후 실제 시험 발송이 필요합니다.
