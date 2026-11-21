/**
 * TikTok PC Pro Toolkit - Popup Logic
 */
document.addEventListener('DOMContentLoaded', async () => {
  const ghostToggle = document.getElementById('toggle-ghost-mode');
  const statsToggle = document.getElementById('toggle-show-stats');
  const zipToggle = document.getElementById('toggle-auto-zip');
  const btnModify = document.getElementById('btn-modify-privacy');
  const inputItemId = document.getElementById('input-item-id');
  const selectVisibility = document.getElementById('select-visibility');
  const resultMsg = document.getElementById('privacy-result');
  const developerTools = document.getElementById('developer-tools');
  const reloadExtensionButton = document.getElementById('btn-reload-extension');

  // Show the self-reload control only for an unpacked development install.
  try {
    const extensionInfo = await chrome.management.getSelf();
    developerTools.hidden = extensionInfo.installType !== 'development';
  } catch (error) {
    developerTools.hidden = true;
  }

  reloadExtensionButton.addEventListener('click', () => {
    reloadExtensionButton.disabled = true;
    chrome.runtime.reload();
  });

  // 1. Load initial settings from chrome.storage
  chrome.storage.local.get(['ghostMode', 'showStats', 'autoZipPhotos'], (res) => {
    if (res.ghostMode !== undefined) ghostToggle.checked = res.ghostMode;
    if (res.showStats !== undefined) statsToggle.checked = res.showStats;
    if (res.autoZipPhotos !== undefined) zipToggle.checked = res.autoZipPhotos;
  });

  // 2. Ghost Mode toggle
  ghostToggle.addEventListener('change', () => {
    const enabled = ghostToggle.checked;
    chrome.storage.local.set({ ghostMode: enabled });
    chrome.runtime.sendMessage({
      action: 'TOGGLE_GHOST_MODE',
      enabled: enabled
    });
  });

  // 3. Stats & Zip toggles
  statsToggle.addEventListener('change', () => {
    chrome.storage.local.set({ showStats: statsToggle.checked });
  });

  zipToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoZipPhotos: zipToggle.checked });
  });

  // 4. Modify Privacy Handler
  function showResult(text, isSuccess) {
    resultMsg.textContent = text;
    resultMsg.className = 'result-message ' + (isSuccess ? 'success' : 'error');
  }

  btnModify.addEventListener('click', async () => {
    const itemId = inputItemId.value.trim();
    const visibility = selectVisibility.value;

    if (!/^\d+$/.test(itemId)) {
      showResult('⚠️ Vui lòng nhập ID Video / Story hợp lệ.', false);
      return;
    }

    showResult('⏳ Đang gửi yêu cầu đổi quyền riêng tư...', true);

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab || !activeTab.url || !activeTab.url.includes('tiktok.com')) {
        showResult('⚠️ Vui lòng mở trang TikTok trên tab đang xem trước.', false);
        return;
      }

      // Forward the request once to the page's MAIN-world API hook.
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: (id, vis) => {
          window.postMessage({
            source: 'TIKTOK_TOOLKIT_CONTENT',
            type: 'CALL_MODIFY_PRIVACY',
            itemId: id,
            visibility: vis
          }, '*');
        },
        args: [itemId, visibility]
      });

      showResult('🚀 Đã gửi lệnh cập nhật! Kiểm tra thông báo trên trang TikTok.', true);
    } catch (err) {
      showResult('❌ Lỗi: ' + err.message, false);
    }
  });
});
