chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "TEST_NOTIFY") return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title: "NU 测试工具",
    message: "如果你看到这条通知，说明桌面通知正常。",
    priority: 2,
  });
});
