import { writeFile } from "node:fs/promises";
import { CONFIG } from "../js/config.js";
const cutoff = (meal) => {
  const rule = CONFIG.deadlines[meal];
  const [h, m] = rule.time.split(":").map(Number);
  return rule.offsetDays * 1440 + h * 60 + m - 540;
};
const menus = (meal) =>
  CONFIG.menus.filter((menu) =>
    CONFIG.menuRules[meal].only
      ? CONFIG.menuRules[meal].only.includes(menu)
      : !CONFIG.menuRules[meal].exclude.includes(menu),
  );
const list = (values) => JSON.stringify(values);
const rules = `// 자동 생성: node scripts/build-firestore-rules.mjs
// 인증 없는 테스트 전용. 실제 개인정보를 저장하지 마세요.
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function validProfile(d) {
      return d.group in ${list(Object.keys(CONFIG.groups))}
        && d.name is string && d.name.size() >= 1 && d.name.size() <= 40
        && d.empId is string && d.company is string && d.phone is string
        && (d.group == 'gs'
          ? (d.empId.matches('^[A-Za-z0-9-]{1,30}$') && d.company == '' && d.phone == '')
          : (d.empId == '' && d.company.size() >= 1 && d.company.size() <= 80 && d.phone.matches('^[0-9]{8,15}$')));
    }
    function validMeal(d) {
      return (d.menu == ${JSON.stringify(CONFIG.noOrder)} && d.location == '')
        || (d.meal == 'lunch' && d.menu in ${list(menus("lunch"))} && d.location in ${list(CONFIG.locations)})
        || (d.meal == 'breakfast' && d.menu in ${list(menus("breakfast"))} && d.location == '')
        || (d.meal == 'dinner' && d.menu in ${list(menus("dinner"))} && d.location == '');
    }
    function beforeDeadline(d) {
      let parts = d.date.split('-');
      let date = timestamp.date(int(parts[0]), int(parts[1]), int(parts[2]));
      let minutes = d.meal == 'breakfast' ? ${cutoff("breakfast")} : d.meal == 'lunch' ? ${cutoff("lunch")} : ${cutoff("dinner")};
      return request.time < date + duration.value(minutes, 'm');
    }
    function validOrder(d) {
      return d.keys().hasAll(['id','requesterKey','group','empId','company','name','phone','date','meal','menu','location','updatedAt'])
        && d.keys().hasOnly(['id','requesterKey','group','empId','company','name','phone','date','meal','menu','location','updatedAt'])
        && d.id is string && d.id.size() <= 1000
        && d.requesterKey is string && d.requesterKey.size() <= 500
        && d.date is string && d.date.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && d.meal in ${list(Object.keys(CONFIG.meals))}
        && d.menu is string && d.location is string
        && d.updatedAt == request.time
        && validProfile(d) && validMeal(d) && beforeDeadline(d);
    }
    // 의도적으로 공개된 테스트 컬렉션입니다. 화면 비밀번호는 DB 접근을 막지 않습니다.
    match /aurora_v2_orders/{orderId} {
      allow read, delete: if true;
      allow create, update: if validOrder(request.resource.data);
    }
  }
}
`;
await writeFile(new URL("../firestore.rules", import.meta.url), rules);
