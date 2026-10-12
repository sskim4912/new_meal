// 매번 새 URL로 문서 전체를 불러와 홈의 입력 상태를 초기화합니다.
document.querySelectorAll("[data-home]").forEach((link) => {
  link.addEventListener("click", () => {
    const home = new URL("../index.html", import.meta.url);
    home.searchParams.set("start", "new");
    home.searchParams.set("refresh", String(Date.now()));
    link.href = home.href;
  });
});
