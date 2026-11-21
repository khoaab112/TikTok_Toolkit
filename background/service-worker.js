/**
 * TikTok PC Pro Toolkit - Background Service Worker (Manifest V3)
 * Full CORS bypass, Referer injection across all TikTok CDNs,
 * 2-stage fallback download engine, and Complete Ghost Mode Telemetry Suppression.
 */

try {
  importScripts('../utils/zip-helper.js');
} catch (e) {
  console.warn('[TikTok Toolkit] importScripts zip-helper:', e);
}

// 1. Ghost Mode: Comprehensive telemetry and view-tracking suppression rules (IDs 101 - 116)
const GHOST_RULES = [
  // 1. Block ByteDance TEA Event Tracking & Telemetry domains entirely
  {
    id: 101,
    priority: 10,
    action: { type: 'block' },
    condition: {
      requestDomains: [
        'mcs-sg.tiktokv.com',
        'mcs.tiktokv.com',
        'mcs-va.tiktokv.com',
        'mcs.tiktok.com',
        'mcs-alisg.tiktokv.com',
        'mcs-maliva.tiktokv.com',
        'mon-sg.tiktokv.com',
        'mon.tiktokv.com',
        'mon-va.tiktokv.com',
        'mssdk-sg.tiktok.com',
        'mssdk.tiktok.com',
        'mssdk-va.tiktok.com'
      ],
      resourceTypes: ['xmlhttprequest', 'ping', 'other', 'script', 'image', 'sub_frame', 'websocket']
    }
  },
  // 2. Block Screen Time & Watch Duration Uploads (www.tiktok.com)
  {
    id: 102,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*screen_time/upload*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 3. Block App Open Times Uploads (www.tiktok.com)
  {
    id: 103,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*app_open_times/upload*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 4. Block Any Screen Time Endpoints
  {
    id: 104,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*tiktok/v1/screen_time*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 5. Block Any App Open Times Endpoints
  {
    id: 105,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*tiktok/v1/app_open_times*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 6. Block Event Reporting /v1/list
  {
    id: 106,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*/v1/list*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 7. Block Slardar Browser Monitoring
  {
    id: 107,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*monitor_browser/collect*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 8. Block Web Security / Dynosaur Reports
  {
    id: 108,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*web/report*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  // 9. Block Story Ack / Seen / View Endpoints
  {
    id: 109,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*story/ack*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  {
    id: 110,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*story/seen*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  {
    id: 111,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*story/view*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  {
    id: 112,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*aweme/v1/story/view*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  {
    id: 113,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*aweme/v1/story/ack*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  },
  {
    id: 115,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: "*commit/item/view*",
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  }
];

// 2. Referer header injection for TikTok CDNs and media domains (IDs 201 - 206)
const REFERER_RULES = [
  {
    id: 201,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://www.tiktok.com/'
        }
      ]
    },
    condition: {
      urlFilter: "||tiktokcdn.com",
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  },
  {
    id: 202,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://www.tiktok.com/'
        }
      ]
    },
    condition: {
      urlFilter: "||byteoversea.com",
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  },
  {
    id: 203,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://www.tiktok.com/'
        }
      ]
    },
    condition: {
      urlFilter: "||ibytedtos.com",
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  },
  {
    id: 204,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://www.tiktok.com/'
        }
      ]
    },
    condition: {
      urlFilter: "||tiktok.com",
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  },
  {
    id: 205,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://www.tiktok.com/'
        }
      ]
    },
    condition: {
      urlFilter: "||tiktokv.com",
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  },
  {
    id: 206,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://www.tiktok.com/'
        }
      ]
    },
    condition: {
      urlFilter: "||akamaized.net",
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  }
];

// Synchronize declarativeNetRequest dynamic rules
async function syncRules() {
  try {
    const data = await chrome.storage.local.get(['ghostMode']);
    const ghostMode = (data.ghostMode !== undefined) ? Boolean(data.ghostMode) : true;

    const ghostIds = GHOST_RULES.map(r => r.id);
    const refererIds = REFERER_RULES.map(r => r.id);
    // Remove rule 114 left by earlier versions, which blocked view statistics.
    const removeIds = [...ghostIds, ...refererIds, 114];

    const rulesToAdd = [...REFERER_RULES];
    if (ghostMode) {
      rulesToAdd.push(...GHOST_RULES);
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: rulesToAdd
    });

    console.log(`[TikTok Toolkit] DNR rules synchronized. Ghost Mode: ${ghostMode ? 'ACTIVE (BLOCKING)' : 'INACTIVE'}`);
  } catch (err) {
    console.warn('[TikTok Toolkit] syncRules error:', err);
  }
}

// Initial sync on SW load, install, or startup
chrome.runtime.onInstalled.addListener(() => {
  syncRules();
  try {
    chrome.tabs.query({ url: "*://*.tiktok.com/*" }, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      for (const tab of tabs) {
        if (tab && tab.id) {
          chrome.tabs.reload(tab.id);
        }
      }
    });
  } catch (e) { }
});
chrome.runtime.onStartup.addListener(syncRules);
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.ghostMode !== undefined) {
    syncRules();
  }
});
syncRules();

// Helper: Convert Uint8Array to base64 in service worker
function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Clean filename for Windows / OS safety
function sanitizeFilename(name) {
  return String(name || 'tiktok_media')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

// Runtime Message Handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  // 1. Download Video with 2-Stage Fallback
  if (action === 'DOWNLOAD_MEDIA') {
    const rawName = request.filename || `tiktok_${Date.now()}.mp4`;
    const cleanName = sanitizeFilename(rawName.endsWith('.mp4') ? rawName : rawName + '.mp4');
    let targetUrl = request.url;

    if (!targetUrl || typeof targetUrl !== 'string') {
      sendResponse({ success: false, error: 'URL video rỗng.' });
      return false;
    }

    targetUrl = targetUrl.replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&').trim();

    // Direct Base64 Data URL
    if (targetUrl.startsWith('data:')) {
      chrome.downloads.download({
        url: targetUrl,
        filename: cleanName,
        saveAs: false,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Lỗi download' });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
      return true;
    }

    (async () => {
      try {
        // Fetch stream directly in Service Worker with Referer header to verify content & prevent 404/json download
        const resp = await fetch(targetUrl, {
          headers: {
            'Referer': 'https://www.tiktok.com/'
          }
        });

        if (!resp.ok) {
          sendResponse({ success: false, error: `Máy chủ trả về HTTP ${resp.status}` });
          return;
        }

        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json') || contentType.includes('text/html')) {
          sendResponse({ success: false, error: 'Link video trả về dữ liệu web/lỗi (không phải video mp4).' });
          return;
        }

        const buffer = await resp.arrayBuffer();
        if (!buffer || buffer.byteLength < 1000) {
          sendResponse({ success: false, error: 'Kích thước tệp video quá nhỏ hoặc bị lỗi.' });
          return;
        }

        const bytes = new Uint8Array(buffer);
        const b64 = uint8ArrayToBase64(bytes);
        const dataUrl = `data:video/mp4;base64,${b64}`;

        chrome.downloads.download({
          url: dataUrl,
          filename: cleanName,
          saveAs: false,
          conflictAction: 'uniquify'
        }, (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Lỗi lưu tệp MP4' });
          } else {
            sendResponse({ success: true, downloadId });
          }
        });
      } catch (fetchErr) {
        // Fallback: Direct Chrome download with DNR header injection
        chrome.downloads.download({
          url: targetUrl,
          filename: cleanName,
          saveAs: false,
          conflictAction: 'uniquify'
        }, (fallbackId) => {
          if (chrome.runtime.lastError || !fallbackId) {
            sendResponse({ success: false, error: fetchErr.message || 'Không thể tải video' });
          } else {
            sendResponse({ success: true, downloadId: fallbackId });
          }
        });
      }
    })();

    return true; // Keep async channel open
  }

  // 2. Fetch image buffer with Referer header (Bypasses any CORS in Content Script)
  if (action === 'FETCH_IMAGE_BUFFER') {
    const targetUrl = request.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
      sendResponse({ success: false, error: 'URL rỗng' });
      return false;
    }

    (async () => {
      try {
        const resp = await fetch(targetUrl, {
          headers: {
            'Referer': 'https://www.tiktok.com/'
          }
        });
        if (!resp.ok) {
          sendResponse({ success: false, status: resp.status });
          return;
        }
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const b64 = uint8ArrayToBase64(bytes);
        sendResponse({ success: true, base64: b64, contentType: resp.headers.get('content-type') });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Download ZIP with Full Resolution Images
  if (action === 'DOWNLOAD_ZIP_IMAGES') {
    const rawZipName = request.filename || `tiktok_photos_${Date.now()}.zip`;
    const cleanZipName = sanitizeFilename(rawZipName.endsWith('.zip') ? rawZipName : rawZipName + '.zip');
    const rawUrls = request.images || [];

    if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
      sendResponse({ success: false, error: 'Không tìm thấy ảnh hợp lệ.' });
      return false;
    }

    const seenKeys = new Set();
    const imageUrls = [];
    for (const u of rawUrls) {
      if (!u || typeof u !== 'string') continue;
      const cleanUrl = u.replace(/\\u0026/g, '&');
      let key = cleanUrl;
      const m1 = cleanUrl.match(/(tos-[^\/]+?\/[a-zA-Z0-9_-]+)/);
      if (m1) {
        key = m1[1];
      } else {
        const m2 = cleanUrl.match(/\/([a-zA-Z0-9_-]{16,})(?:~tplv|\.jpeg|\.png|\.webp|\?|$)/);
        if (m2) key = m2[1];
      }
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        imageUrls.push(cleanUrl);
      }
    }

    (async () => {
      try {
        const ZipClass = self.SimpleZip || self.MiniZip;
        if (!ZipClass) throw new Error('Zip helper not loaded');
        const zip = new ZipClass();
        let addedCount = 0;

        for (let i = 0; i < imageUrls.length; i++) {
          let u = imageUrls[i];
          if (!u || typeof u !== 'string') continue;

          try {
            let imgRes = await fetch(u, {
              headers: {
                'Referer': 'https://www.tiktok.com/'
              }
            });

            if (imgRes.ok) {
              const buf = await imgRes.arrayBuffer();
              const ext = u.includes('.png') ? 'png' : (u.includes('.webp') ? 'webp' : 'jpg');
              const imgName = `photo_${String(i + 1).padStart(2, '0')}.${ext}`;
              zip.addFile(imgName, buf);
              addedCount++;
            }
          } catch (e) {
            console.warn('[TikTok Toolkit] Error fetching image:', u, e);
          }
        }

        if (addedCount === 0) {
          sendResponse({ success: false, error: 'Không thể tải về dữ liệu ảnh.' });
          return;
        }

        const zipData = zip.generateUint8Array ? zip.generateUint8Array() : zip.generate();
        const b64 = (zipData instanceof Uint8Array) ? uint8ArrayToBase64(zipData) : '';
        const dataUrl = `data:application/zip;base64,${b64}`;

        chrome.downloads.download({
          url: dataUrl,
          filename: cleanZipName,
          saveAs: false,
          conflictAction: 'uniquify'
        }, (zipDownloadId) => {
          if (chrome.runtime.lastError || !zipDownloadId) {
            sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Lỗi lưu ZIP' });
          } else {
            sendResponse({ success: true, downloadId: zipDownloadId, count: addedCount });
          }
        });
      } catch (zipErr) {
        sendResponse({ success: false, error: zipErr.message || 'Lỗi tạo ZIP' });
      }
    })();

    return true;
  }

  // 4. Toggle Ghost Mode
  if (action === 'TOGGLE_GHOST_MODE') {
    const enabled = Boolean(request.enabled);
    (async () => {
      await chrome.storage.local.set({ ghostMode: enabled });
      await syncRules();
      sendResponse({ success: true, ghostMode: enabled });
    })();
    return true;
  }
});
