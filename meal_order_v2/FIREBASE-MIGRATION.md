# Firebase 전환 결과와 남은 설정

사용자 선택에 따라 GitHub Pages 화면 + 인증 없는 Firestore 테스트 저장 구조입니다. Cloud Functions와 Firebase Authentication은 사용하지 않습니다. 화면 입력 항목을 유지합니다. 기본정보는 기기에 기억하고 신청만 Firestore에 저장합니다.

관리자 비밀번호는 화면 잠금이며 서버 데이터 권한을 제한하지 않습니다. 프로젝트는 new-meal-7b1c8, 테스트 컬렉션은 aurora_v2_orders입니다.

Firebase 콘솔에서 기본 Firestore 데이터베이스와 firestore.rules의 규칙 게시가 필요합니다. 기존 다른 컬렉션 규칙을 보존하세요. 기존 localStorage 신청은 자동으로 업로드하지 않습니다.

검증 결과는 GitHub Actions 및 작업 완료 보고를 참고하세요. 실행하지 않은 실제 클라우드 검증을 완료로 간주하지 않습니다.
