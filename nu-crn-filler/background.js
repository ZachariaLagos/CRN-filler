// Shows desktop notifications for the content script.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "ALERT") return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title: msg.title || "NU CRN Filler",
    message: msg.message || "",
    priority: 2,
    requireInteraction: !!msg.urgent,
  });
});
