// 메뉴·가격·장소·마감 변경은 이 파일에서 관리합니다.
export const CONFIG = {
  projectName: "Aurora Project",
  groups: { gs: "GS직원", partner: "협력사", vip: "VIP" },
  meals: { breakfast: "조식", lunch: "중식", dinner: "석식" },
  noOrder: "신청 안 함",
  locations: ["사무실", "OSBL", "ISBL"],
  menus: [
    "샐러드(닭가슴살)",
    "샐러드(오리훈제)",
    "샐러드(치킨텐더)",
    "샌드위치(매쉬포테이토)",
    "샌드위치(치킨텐더)",
    "볶음밥(김치)",
    "볶음밥(중국식)",
    "백반",
  ],
  menuRules: {
    breakfast: { exclude: ["백반"] },
    lunch: { only: ["백반"] },
    dinner: { exclude: ["백반"] },
  },
  prices: { 백반: 8000, default: 9000 },
  deadlines: {
    breakfast: { offsetDays: -1, time: "13:00" },
    lunch: { offsetDays: 0, time: "09:00" },
    dinner: { offsetDays: 0, time: "13:00" },
  },
  adminPassword: "230880",
};
export const price = (menu) =>
  menu === CONFIG.noOrder ? 0 : (CONFIG.prices[menu] ?? CONFIG.prices.default);
