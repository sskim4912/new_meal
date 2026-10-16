# 관리자 로그인·VIP 대리신청 운영 전환

구현은 준비되어 있지만, 아래 설정을 끝내기 전에는 운영 main에 병합하지 않습니다. 새 로그인은 서버 인증을 요구하므로 서버 설정이 없는 상태에서 화면만 배포하면 관리자 로그인이 차단됩니다. 기존 일반 신청 데이터는 이 전환으로 변경하지 않습니다.

## 1. Firebase 관리자 전용 계정 만들기

1. Firebase 콘솔에서 **new-meal-7b1c8** 프로젝트를 엽니다.
2. **Authentication → 로그인 방법 → 이메일/비밀번호**를 사용 설정합니다. 이메일 링크 로그인은 필요 없습니다.
3. **사용자 → 사용자 추가**에서 관리자 서버 전용 이메일과 강한 비밀번호로 계정 하나를 만듭니다.
4. 추가된 사용자의 **사용자 UID**를 복사합니다. 이 계정은 Cloudflare만 사용하며 일반 신청자에게 Firebase 로그인 화면을 보여주지 않습니다.
5. **Firestore Database → 데이터 → 컬렉션 시작**을 눌러 `aurora_v2_admins` 컬렉션을 만듭니다.
6. 문서 ID를 위 **사용자 UID**로 지정하고, 필드 `enabled` / 유형 **boolean** / 값 **true**를 추가합니다. 문자열 `"true"`로 만들지 않습니다.

계정 비밀번호는 채팅·GitHub 파일에 입력하지 않습니다. 서비스 계정 JSON이나 비공개 키는 필요 없습니다.

## 2. Cloudflare Secret 세 개 추가

Cloudflare → Workers & Pages → **new-meal-sms** → Settings → Variables and Secrets → Production에서 다음 항목을 **Secret**으로 추가합니다.

| 이름 | 값 |
|---|---|
| `ADMIN_PASSWORD` | 합의한 관리자 비밀번호 `230880` |
| `FIREBASE_ADMIN_EMAIL` | 1단계에서 만든 관리자 전용 계정 이메일 |
| `FIREBASE_ADMIN_PASSWORD` | 같은 계정의 강한 비밀번호 |

이미 등록한 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_FROM_NUMBER`, `ALLOWED_ORIGIN`은 유지합니다. 기존 `SMS_ADMIN_TOKEN`은 새 세션 로그인에서 사용하지 않으므로 다시 입력하거나 전달할 필요가 없습니다. 일반 화면에는 새로운 비밀값을 넣지 않습니다.

설정을 저장·배포합니다. 기존 Worker 코드는 새 Secret을 사용하지 않으므로 이 설정만 추가하는 단계에서 기존 기능은 유지됩니다.

## 3. Firestore 규칙 게시

이 변경에 포함된 **meal_order_v2/firestore.rules 전체**를 Firebase 콘솔의 **Firestore Database → 규칙**에 반영하고 **게시**합니다. 같은 프로젝트에 다른 컬렉션 규칙이 있다면 해당 규칙을 유지하며 합칩니다.

새 규칙은 기존 일반 신청의 마감을 유지하고 `source: admin-proxy`인 신규 대리신청만 등록된 관리자에게 허용합니다. 관리자 전용 계정이라도 식사일 10:00 이후에는 대리신청 신규·수정·삭제가 거절됩니다. 원래 날짜의 마감이 지난 신청을 미래로 옮기는 변경도 차단합니다.

## 4. 준비 완료 후 코드 전환

1~3단계가 끝나면 이 채팅에 **“관리자 V2 설정 완료”**라고 알려주세요. 준비된 변경을 main에 병합하여 GitHub Pages와 연결된 Cloudflare Git 배포를 전환합니다.

Cloudflare의 Git 자동 배포가 켜져 있지 않다면 Workers & Pages의 new-meal-sms → Deployments에서 main을 다시 배포합니다. Root directory는 `meal_order_v2/sms-worker`, Deploy command는 `npx wrangler deploy`입니다. `wrangler.toml`의 기존 `v1`과 신규 `v2` migration을 모두 유지해야 새 `ADMIN` Durable Object가 연결됩니다.

이 환경에는 Cloudflare 배포 토큰과 Firebase 콘솔 게시 인증이 없어 위 콘솔 설정을 직접 실행할 수 없습니다. 인증키나 계정 비밀번호를 채팅으로 보내지 않습니다.

## 5. 운영 확인

1. 관리자 화면을 새로 열어 **230880만 입력**합니다. 문자 발송 인증키 칸은 없어야 합니다.
2. 직원 화면의 VIP·본사출장을 눌러 같은 세션으로 대리신청에 들어갑니다.
3. 미래 날짜에 소속·이름을 입력하여 저장하고 관리자 집계·상세내역·CSV에서 **관리자 대리신청** 표시를 확인합니다. 수량은 1, 장소는 사무실입니다.
4. 같은 날짜·이름의 GS 중식 신청이 있으면 중복 경고를 확인합니다. 확인 전에는 저장되지 않습니다.
5. 일반 중식 09:00, 대리신청 10:00 마감을 확인합니다. 시각과 같거나 늦으면 마감입니다.
6. 중식 문자는 **일별·전체** 조회 후 집계 종류를 **중식 1차 집계** 또는 **중식 최종 집계**로 선택합니다. 미리보기를 확인하고 관리자가 수동 발송합니다.
7. 솔라피가 1차 발송을 접수한 경우에만 비교 기준이 저장됩니다. 최종 문자는 전체·장소별 수량, 1차 대비 증감, 추가·취소·변경 건수를 표시합니다. 집계 기준과 실제 발송 요청 시각은 한국시간으로 함께 표시됩니다.

미리보기는 5분간 유효합니다. 1차를 다시 발송해 접수되면 최신 1차가 비교 기준이 됩니다. 1차 기록이 없으면 **1차 발송 기록 없음**으로 표시합니다. 발송 접수는 수신 완료와 다르므로 솔라피 발송 내역도 확인합니다.

로그인은 같은 탭의 페이지 이동·새로고침에서 최대 8시간 유지되고 로그아웃·만료 시 다시 입력합니다. 로그인 실패 5회 후 해당 접속 IP에서는 15분간 새 로그인이 제한됩니다. 문자 발송은 자동화하지 않았습니다.

## 검증 명령

```sh
cd /workspace/new_meal/meal_order_v2
npm ci --cache /tmp/aurora-npm-cache --no-audit --no-fund
npm test
FIREBASE_EMULATORS_PATH=/tmp/aurora-firebase-emulators XDG_CONFIG_HOME=/tmp/aurora-firebase-config npm run test:firestore
```

별도 터미널에서 `python3 -m http.server 8000 --bind 127.0.0.1` 실행 후:

```sh
AURORA_TEST_URL=http://127.0.0.1:8000 python3 tests/browser_test.py
AURORA_TEST_URL=http://127.0.0.1:8000 python3 tests/vip_browser_test.py
AURORA_TEST_URL=http://127.0.0.1:8000 python3 tests/sms_browser_test.py
```

브라우저 검사는 가짜 관리자 API·문자 응답과 독립 로컬 데이터를 사용합니다. 실제 솔라피 발송을 하지 않습니다. Firebase 검사는 demo-aurora의 Auth·Firestore 에뮬레이터만 사용합니다.
