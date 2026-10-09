// 공개 Firebase 웹 앱 설정입니다. 서비스 계정 비공개 키는 넣지 마세요.
// 인증 없는 테스트 전용: 실제 개인정보를 입력하지 마세요.
export const FIREBASE = {
  enabled: true,
  collection: "aurora_v2_orders",
  config: {
    apiKey: "AIzaSyDhet249oJ0-zFbZanaWM90USwtZcg0ShQ",
    authDomain: "new-meal-7b1c8.firebaseapp.com",
    projectId: "new-meal-7b1c8",
    storageBucket: "new-meal-7b1c8.firebasestorage.app",
    messagingSenderId: "1087449260427",
    appId: "1:1087449260427:web:b664830f2b6e3c0572cf8e",
  },
  // 에뮬레이터는 개발 설정에서만 명시합니다. URL 매개변수로 연결 대상을 바꾸지 않습니다.
  emulator: null,
};
