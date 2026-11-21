/**
 * TikTok PC Pro Toolkit - Content Script (ISOLATED World)
 * Multi-layer fallback video and photo downloader.
 * Real-time DOM + API stats scraper (supports Stories, Videos, Photo carousels).
 * Synchronizes Ghost Mode with MAIN world and Background Service Worker.
 */
(function () {
  console.log('%c[TikTok Pro Toolkit v1.2.13] Active on:', 'color:#25f4ee;font-weight:bold;font-size:13px;', window.location.href);

  // Clean up any previous loop interval in this tab to prevent ghost loops
  if (window.__TIKTOK_TOOLKIT_LOOP_INTERVAL__) {
    clearInterval(window.__TIKTOK_TOOLKIT_LOOP_INTERVAL__);
    window.__TIKTOK_TOOLKIT_LOOP_INTERVAL__ = null;
  }

  const itemsMap = new Map();
  let activeMediaContainer = null;
  let activeFeedItemFromMainWorld = null;
  let ghostModeActive = true;
  let showStats = true;
  let autoZipPhotos = true;
  let lastCapturedStreamUrl = '';

  // Safe extension context check
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Toast Helper
  function showToast(msg, duration = 3000) {
    let t = document.getElementById('tk-pro-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tk-pro-toast';
      t.className = 'tk-pro-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), duration);
  }

  // Notify MAIN world of Ghost Mode status
  function notifyMainWorldGhostMode(enabled) {
    try {
      window.postMessage({
        source: 'TIKTOK_TOOLKIT_CONTENT',
        type: 'SET_GHOST_MODE',
        enabled: Boolean(enabled)
      }, '*');
    } catch (e) { }
  }

  // Check stored Ghost Mode safely
  if (isExtensionValid()) {
    try {
      chrome.storage?.local?.get(['ghostMode', 'showStats', 'autoZipPhotos'], (res) => {
        if (!isExtensionValid()) return;
        if (res && res.ghostMode !== undefined) {
          ghostModeActive = Boolean(res.ghostMode);
        }
        if (res && res.showStats !== undefined) showStats = Boolean(res.showStats);
        if (res && res.autoZipPhotos !== undefined) autoZipPhotos = Boolean(res.autoZipPhotos);
        notifyMainWorldGhostMode(ghostModeActive);
        updateStatsVisibility();
        updateGhostModeUI();
      });

      chrome.storage?.onChanged?.addListener((changes, namespace) => {
        if (!isExtensionValid()) return;
        if (namespace === 'local' && changes.ghostMode !== undefined) {
          ghostModeActive = Boolean(changes.ghostMode.newValue);
          notifyMainWorldGhostMode(ghostModeActive);
          updateGhostModeUI();
        }
        if (namespace === 'local' && changes.showStats !== undefined) {
          showStats = Boolean(changes.showStats.newValue);
          updateStatsVisibility();
        }
        if (namespace === 'local' && changes.autoZipPhotos !== undefined) {
          autoZipPhotos = Boolean(changes.autoZipPhotos.newValue);
        }
      });
    } catch (e) { }
  }

  function updateStatsVisibility() {
    const stats = document.querySelector('#tk-pro-floating-widget .tk-pro-stats-grid');
    if (stats) stats.style.display = showStats ? '' : 'none';
    const status = document.querySelector('#tk-pro-floating-widget .tk-pro-stats-status');
    if (status) status.style.display = showStats ? '' : 'none';
  }

  function setStatsStatus(message, state = 'idle') {
    const status = document.getElementById('tk-pro-stats-status');
    if (!status) return;
    setTextIfChanged(status, message);
    status.dataset.state = state;
  }

  // Clean URL escaping and unicode slashes
  function cleanMediaUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
      .replace(/\\u002F/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003D/gi, '=')
      .trim();
  }

  // Permissive yet strict video validator: must be a video, NEVER an image, avatar, or API
  function isActualVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = cleanMediaUrl(url);
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) return false;

    // Never accept images, avatars, html, or api calls as a video
    if (
      clean.includes('.jpeg') ||
      clean.includes('.jpg') ||
      clean.includes('.png') ||
      clean.includes('.webp') ||
      clean.includes('.avif') ||
      clean.includes('.gif') ||
      clean.includes('/avatar/') ||
      clean.includes('/avt-') ||
      clean.includes('/api/') ||
      clean.includes('tiktok.com/@')
    ) {
      return false;
    }

    return (
      clean.includes('mime_type=video_mp4') ||
      clean.includes('/video/tos/') ||
      clean.includes('.mp4') ||
      clean.includes('playAddr') ||
      clean.includes('play_addr')
    );
  }

  // Deep search for any media URL in an object
  function findAnyMediaUrl(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') {
      const clean = cleanMediaUrl(obj);
      if (isActualVideoUrl(clean)) {
        return clean;
      }
      return '';
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findAnyMediaUrl(item);
        if (found) return found;
      }
      return '';
    }

    if (typeof obj === 'object') {
      const priorityKeys = [
        'playAddr', 'play_addr',
        'play_addr_h264', 'play_addr_bytevc1',
        'downloadAddr', 'download_addr',
        'urlList', 'url_list', 'UrlList',
        'bitrateInfo', 'bit_rate', 'bitrate'
      ];
      for (const key of priorityKeys) {
        if (obj[key]) {
          const found = findAnyMediaUrl(obj[key]);
          if (found) return found;
        }
      }
    }
    return '';
  }

  // Extract clean video URL from any video object
  function extractVideoUrl(videoObj) {
    if (!videoObj) return '';
    if (typeof videoObj === 'string' && isActualVideoUrl(videoObj)) return cleanMediaUrl(videoObj);
    if (videoObj.videoUrl && isActualVideoUrl(videoObj.videoUrl)) return cleanMediaUrl(videoObj.videoUrl);

    const candidates = [
      videoObj.playAddr,
      videoObj.play_addr,
      videoObj.downloadAddr,
      videoObj.download_addr,
      videoObj.bitrateInfo?.[0]?.playAddr,
      videoObj.bit_rate?.[0]?.play_addr,
      videoObj.bitrate?.[0]?.playAddr,
      videoObj.PlayAddrStruct
    ];

    for (const c of candidates) {
      if (!c) continue;
      if (typeof c === 'string' && isActualVideoUrl(c)) return cleanMediaUrl(c);
      if (Array.isArray(c)) {
        for (const item of c) {
          if (typeof item === 'string' && isActualVideoUrl(item)) return cleanMediaUrl(item);
        }
      }
      if (typeof c === 'object') {
        const list = c.urlList || c.url_list || c.UrlList;
        if (Array.isArray(list)) {
          for (const item of list) {
            if (typeof item === 'string' && isActualVideoUrl(item)) return cleanMediaUrl(item);
          }
        }
      }
    }

    return findAnyMediaUrl(videoObj);
  }

  // Extract unique image key / hash to avoid duplicate CDN mirrors of the same photo
  function getImageKey(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const clean = url.replace(/\\u0026/g, '&');
      const m1 = clean.match(/(tos-[^\/]+?\/[a-zA-Z0-9_-]+)/);
      if (m1) return m1[1];
      const m2 = clean.match(/\/([a-zA-Z0-9_-]{16,})(?:~tplv|\.jpeg|\.png|\.webp|\?|$)/);
      if (m2) return m2[1];
      return clean.split('?')[0].replace(/^https?:\/\/[^\/]+/, '');
    } catch (e) {
      return url;
    }
  }

  // Deduplicate image URLs based on their unique image hash/path
  function deduplicatePhotoUrls(urls) {
    if (!Array.isArray(urls)) return [];
    const seen = new Set();
    const result = [];
    for (let u of urls) {
      if (!u || typeof u !== 'string') continue;
      const cleanUrl = u.replace(/\\u0026/g, '&');
      const key = getImageKey(cleanUrl);
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(cleanUrl);
      }
    }
    return result;
  }

  // Pick the single best URL from an image item's urlList (never return array of mirror CDNs)
  function pickBestImageUrl(imgObj) {
    if (!imgObj) return '';
    if (typeof imgObj === 'string' && imgObj.startsWith('http')) return imgObj.replace(/\\u0026/g, '&');

    const candidates = [
      imgObj.displayImage?.urlList,
      imgObj.imageURL?.urlList,
      imgObj.thumbnail?.urlList,
      imgObj.urlList,
      imgObj.url_list
    ];

    for (const list of candidates) {
      if (Array.isArray(list) && list.length > 0) {
        const u = list[list.length - 1] || list[0];
        if (typeof u === 'string' && u.startsWith('http')) {
          return u.replace(/\\u0026/g, '&');
        }
      }
    }
    return '';
  }

  // Extract all unique photos from any TikTok item schema
  function extractPhotosFromItem(item) {
    if (!item) return [];
    const collected = [];

    // Case A: item.imagePostInfo.images (array of photo objects)
    if (Array.isArray(item.imagePostInfo?.images) && item.imagePostInfo.images.length > 0) {
      item.imagePostInfo.images.forEach(img => {
        const u = pickBestImageUrl(img);
        if (u) collected.push(u);
      });
    }

    // Case B: item.imagePost.images (array of photo objects)
    if (collected.length === 0 && Array.isArray(item.imagePost?.images) && item.imagePost.images.length > 0) {
      item.imagePost.images.forEach(img => {
        const u = pickBestImageUrl(img);
        if (u) collected.push(u);
      });
    }

    // Case C: item.images (array of strings or objects)
    if (collected.length === 0 && Array.isArray(item.images) && item.images.length > 0) {
      item.images.forEach(img => {
        const u = pickBestImageUrl(img);
        if (u) collected.push(u);
      });
    }

    return deduplicatePhotoUrls(collected);
  }

  // Register item into itemsMap
  // Feed endpoints sometimes send a partial stats object with zeroes while
  // TikTok is still hydrating the item. Keep the strongest known count so a
  // later partial event cannot erase views already captured for that post.
  function resolveStatCount(candidates, existingValue = 0) {
    let best = Number(existingValue);
    if (!Number.isFinite(best) || best < 0) best = 0;
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null || candidate === '') continue;
      const value = Number(candidate);
      if (Number.isFinite(value) && value > best) best = value;
    }
    return best;
  }

  function registerItem(item, context = '') {
    if (!item) return;
    const id = String(item.id || item.aweme_id || item.itemId || item.video?.id || '');
    if (!id) return;

    // Extract carousel images with strict mirror deduplication
    const images = extractPhotosFromItem(item);

    const existingMedia = itemsMap.get(id);
    const resolvedVideoUrl = extractVideoUrl(item.video) ||
      item.videoUrl ||
      existingMedia?.videoUrl ||
      findAnyMediaUrl(item);
    // Ordinary videos also carry cover images in TikTok's response. A video
    // stream takes precedence so its cover cannot send it down the ZIP path.
    const hasVideo = Boolean(resolvedVideoUrl || item.video?.playAddr || item.video?.play_addr);

    const playCount = resolveStatCount([
      item.stats?.playCount, item.stats?.viewCount, item.stats?.play_count, item.stats?.view_count,
      item.stats?.totalViewers, item.stats?.viewerCount,
      item.statsV2?.playCount, item.statsV2?.viewCount, item.statsV2?.play_count, item.statsV2?.view_count,
      item.statistics?.play_count, item.statistics?.playCount, item.statistics?.viewCount, item.statistics?.view_count,
      item.playCount, item.play_count, item.viewCount, item.view_count,
      item.story?.stats?.playCount, item.story?.stats?.viewCount, item.story?.viewCount
    ], existingMedia?.stats?.playCount);

    const diggCount = resolveStatCount([
      item.stats?.diggCount, item.statsV2?.diggCount, item.statsV2?.digg_count,
      item.statistics?.digg_count, item.statistics?.diggCount
    ], existingMedia?.stats?.diggCount);

    const commentCount = resolveStatCount([
      item.stats?.commentCount, item.statsV2?.commentCount, item.statsV2?.comment_count,
      item.statistics?.comment_count, item.statistics?.commentCount
    ], existingMedia?.stats?.commentCount);

    const isStory = Boolean(
      item.is_story ||
      item.story ||
      context.includes('story') ||
      context.includes('batch_story')
    );

    const parsed = {
      id: id,
      context: context,
      desc: item.desc || existingMedia?.desc || '',
      author: {
        uniqueId: item.author?.uniqueId || existingMedia?.author?.uniqueId || 'tiktok_user',
        nickname: item.author?.nickname || existingMedia?.author?.nickname || '',
        avatar: item.author?.avatarThumb || existingMedia?.author?.avatar || ''
      },
      stats: {
        playCount: playCount,
        diggCount: diggCount,
        commentCount: commentCount
      },
      isStory: isStory,
      isPhotoMode: !hasVideo && (images.length > 0 || Boolean(item.imagePostInfo?.images?.length || item.imagePost?.images?.length) || (existingMedia?.isPhotoMode ?? false)),
      images: hasVideo ? [] : (images.length > 0 ? images : (existingMedia?.images || [])),
      videoUrl: resolvedVideoUrl
    };

    // Bounded LRU cache (max 150 items to prevent memory leaks)
    if (itemsMap.size >= 150) {
      const oldestKey = itemsMap.keys().next().value;
      if (oldestKey) itemsMap.delete(oldestKey);
    }
    itemsMap.set(id, parsed);
  }

  const requestedDetailIds = new Map();
  const DETAIL_RETRY_DELAY_MS = 2500;
  function requestCurrentItemDetails(itemId) {
    const id = String(itemId || '');
    if (!id) return;
    const known = itemsMap.get(id);
    // Zero comments is a valid value. Once views and likes are known, avoid
    // repeatedly requesting an item just because its comment count is zero.
    if (known && known.stats?.playCount > 0 && known.stats?.diggCount > 0) {
      requestedDetailIds.delete(id);
      return;
    }

    const now = Date.now();
    const previousRequest = requestedDetailIds.get(id);
    if (previousRequest?.inFlight || (previousRequest && now - previousRequest.lastAttempt < DETAIL_RETRY_DELAY_MS)) return;

    const requestState = { lastAttempt: now, inFlight: true, status: 'loading' };
    requestedDetailIds.set(id, requestState);
    if (requestedDetailIds.size > 100) {
      requestedDetailIds.delete(requestedDetailIds.keys().next().value);
    }

    fetch(`/api/item/detail/?itemId=${encodeURIComponent(id)}`, { credentials: 'include' })
      .then(response => {
        if (!response.ok) {
          requestState.status = 'error';
          requestState.error = `HTTP ${response.status}`;
          return null;
        }
        return response.json();
      })
      .then(json => {
        const item = json?.itemInfo?.itemStruct || json?.itemStruct || json?.aweme_detail;
        if (item) {
          requestState.status = 'loaded';
          registerItem(item, 'active_item_detail');
        } else if (requestState.status === 'loading') {
          requestState.status = 'unavailable';
        }
        scheduleStatsAndBadgeUpdate();
      })
      .catch(error => {
        requestState.status = 'error';
        requestState.error = error?.message || 'Network error';
        scheduleStatsAndBadgeUpdate();
      })
      .finally(() => {
        if (requestedDetailIds.get(id) === requestState) {
          requestState.inFlight = false;
          scheduleStatsAndBadgeUpdate();
        }
      });
  }

  // Parse SSR initial data (cached to run once per page)
  let lastParsedSSRHref = '';
  function parseSSRData() {
    if (lastParsedSSRHref === location.href) return;
    lastParsedSSRHref = location.href;
    try {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!el || !el.textContent) return;

      const json = JSON.parse(el.textContent);
      const scope = json['__DEFAULT_SCOPE__'] || {};

      for (const scopeKey in scope) {
        const obj = scope[scopeKey];
        if (!obj || typeof obj !== 'object') continue;

        const single = obj.itemInfo?.itemStruct || obj.itemStruct;
        if (single) registerItem(single, 'ssr_single');

        const list = obj.itemList || obj.items || obj.aweme_list;
        if (Array.isArray(list)) {
          list.forEach(i => registerItem(i, 'ssr_list'));
        }
      }
    } catch (e) { }
  }

  parseSSRData();

  // Ask MAIN world for initial cached items (at most 50)
  window.postMessage({ source: 'TIKTOK_TOOLKIT_CONTENT', type: 'REQUEST_ALL_CACHED_ITEMS' }, '*');

  // Throttled UI updater for message events
  let updateDebounceTimer = null;
  function scheduleStatsAndBadgeUpdate(delay = 120) {
    if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
    updateDebounceTimer = setTimeout(() => {
      updateDebounceTimer = null;
      if (document.hidden) return;
      const current = resolveCurrentMedia();
      refreshActiveMediaStats(current);
      updateWidgetDownloadButton(current);
      if (window.location.pathname.startsWith('/@')) {
        injectGridLikesBadge();
      }
    }, delay);
  }

  // Refresh shortly after feed navigation instead of waiting for the polling
  // fallback. TikTok virtualizes Home cards, so scroll and playback events are
  // the most reliable early signals that the active post may have changed.
  const scheduleFeedRefresh = () => {
    activeFeedItemFromMainWorld = null;
    scheduleStatsAndBadgeUpdate(120);
  };
  document.addEventListener('scroll', scheduleFeedRefresh, { capture: true, passive: true });
  window.addEventListener('wheel', scheduleFeedRefresh, { passive: true });
  document.addEventListener('playing', scheduleFeedRefresh, true);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-e2e="feed-navigation-next"], [data-e2e="feed-navigation-prev"]')) {
      scheduleFeedRefresh();
    }
  }, true);
  window.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' '].includes(event.key)) {
      scheduleFeedRefresh();
    }
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loop();
  });

  // Receive data from MAIN World
  window.addEventListener('message', (e) => {
    if (e.data?.source !== 'TIKTOK_TOOLKIT_MAIN') return;

    const { type, payload } = e.data;

    if (type === 'ITEMS_COLLECTED' && Array.isArray(payload)) {
      payload.forEach(item => {
        registerItem(item, 'main_world');
      });
      scheduleStatsAndBadgeUpdate();
    }

    if (type === 'ACTIVE_FEED_ITEM' && payload) {
      registerItem(payload, 'main_world_active_feed');
      activeFeedItemFromMainWorld = {
        id: String(payload.id || payload.aweme_id || ''),
        author: payload.author?.uniqueId?.toLowerCase() || '',
        receivedAt: Date.now()
      };
      scheduleStatsAndBadgeUpdate(0);
    }

    if (type === 'DIRECT_STREAM_CAPTURED' && payload?.url) {
      lastCapturedStreamUrl = payload.url;
    }

    if (type === 'MODIFY_PRIVACY_RESULT') {
      if (payload?.success) {
        showToast('✅ Đã đổi quyền riêng tư thành công!');
      } else {
        showToast('❌ Lỗi đổi quyền riêng tư: ' + (payload?.error || 'Thử lại'));
      }
    }
  });

  // Watch URL changes for SPA navigation WITHOUT heavy document-wide MutationObserver
  let lastUrl = location.href;
  function handleUrlChange() {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    lastCapturedStreamUrl = ''; // Clear stale stream URL from previous video
    // Keep the active job and its progress visible across TikTok SPA navigation.
    if (!isDownloadInProgress) resetButtonState();
    setTimeout(() => {
      parseSSRData();
      const current = resolveCurrentMedia();
      refreshActiveMediaStats(current);
      updateWidgetDownloadButton(current);
      removeLegacyInjectedButtons();
      if (window.location.pathname.startsWith('/@')) {
        injectGridLikesBadge();
      }
    }, 200);
  }

  window.addEventListener('popstate', handleUrlChange);

  // Helper: parse human formatted numbers (e.g. "1.2M", "45.6K", "10,2K")
  function parseHumanNumber(str) {
    if (!str) return 0;
    const clean = String(str).trim();
    const match = clean.match(/^([\d.,]+)\s*([KMBkmb]?)/);
    if (!match) return 0;
    let numeric = match[1];
    const unit = match[2].toUpperCase();
    if (numeric.includes(',') && numeric.includes('.')) {
      numeric = numeric.replace(/,/g, '');
    } else if (numeric.includes(',')) {
      const decimals = numeric.split(',')[1] || '';
      numeric = unit || decimals.length !== 3 ? numeric.replace(',', '.') : numeric.replace(/,/g, '');
    }
    let num = parseFloat(numeric);
    if (isNaN(num)) return 0;
    if (unit === 'K') num *= 1000;
    if (unit === 'M') num *= 1000000;
    if (unit === 'B') num *= 1000000000;
    return Math.round(num);
  }

  // Helper to update text and title only when changed to avoid layout recalculations
  function setTextIfChanged(el, text, title = '') {
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    if (el.title !== title) el.title = title;
  }

  // Scrape stats directly from DOM elements with scoped container (fast & low overhead)
  function scrapeDOMStats() {
    let views = 0;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let isStoryMode = false;

    try {
      const statsRoot = activeMediaContainer || document;
      // Check story indicators in DOM
      const storyProgress = document.querySelector('div[class*="StoryProgress"], div[class*="ProgressBar-"], div[class*="ProgressSegment"]');
      const storyInput = document.querySelector('input[placeholder*="Nhắn tin"], input[placeholder*="Send message"], input[placeholder*="Message"]');
      const storyAuthor = document.querySelector('[data-e2e="story-author-name"]');

      if (
        window.location.href.includes('/story/') ||
        (storyProgress && storyProgress.offsetParent !== null) ||
        (storyInput && storyInput.offsetParent !== null) ||
        (storyAuthor && storyAuthor.offsetParent !== null)
      ) {
        isStoryMode = true;
      }

      // TikTok may expose the Story viewer total in its accessible label or
      // story-specific counter. Read only visible candidates.
      const viewCandidates = statsRoot.querySelectorAll(
        '[data-e2e*="view-count"], [data-e2e*="viewer-count"], [data-e2e*="story-view"], [data-e2e*="video-views"], [title*="lượt xem" i], [title*="views" i], [aria-label*="lượt xem" i], [aria-label*="views" i], [aria-label*="viewers" i]'
      );
      for (const el of viewCandidates) {
        if (el.offsetParent === null) continue;
        const text = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`;
        const match = text.match(/(\d[\d.,]*\s*[KMBkmb]?)\s*(?:lượt xem|views?|viewers?)/i) ||
          text.match(/(?:lượt xem|views?|viewers?)\s*(\d[\d.,]*\s*[KMBkmb]?)/i);
        if (match) {
          views = parseHumanNumber(match[1] || match[2]);
          if (views > 0) break;
        } else if (/view-count|viewer-count|story-view|video-views/i.test(el.getAttribute('data-e2e') || '')) {
          views = parseHumanNumber(el.textContent);
          if (views > 0) break;
        }
      }

      // 1. Scrape Likes from visible buttons
      const likeButtons = statsRoot.querySelectorAll(
        'button[aria-label*="thích"], button[aria-label*="like"], [data-e2e="like-count"], [data-e2e="browse-like-count"], [data-e2e="feed-like-count"], [data-e2e="story-like-count"]'
      );
      for (const btn of likeButtons) {
        if (btn.offsetParent !== null) {
          // TikTok often puts data-e2e="like-count" directly on the <strong>
          // that contains the number. In that case there is no nested strong
          // or span for the legacy child lookup below to find.
          const directCount = parseHumanNumber(btn.textContent);
          if (directCount > 0) {
            likes = directCount;
            break;
          }
          const aria = btn.getAttribute('aria-label') || '';
          const m = aria.match(/(\d[\d.,]*\s*[KMBkmb]?)\s*(?:lượt thích|likes|like)/i) ||
            aria.match(/(?:Thích video|Like video)\s*(\d[\d.,]*\s*[KMBkmb]?)/i);
          if (m) {
            likes = parseHumanNumber(m[1]);
            break;
          }
          const strong = btn.querySelector('strong, span');
          if (strong && strong.textContent) {
            const val = parseHumanNumber(strong.textContent);
            if (val > 0) {
              likes = val;
              break;
            }
          }
        }
      }

      // 2. Story / Photo slide floating action buttons (fast scoped check, avoids global SVG path search)
      if (likes === 0) {
        const activeContainer = statsRoot;
        const likeActionEl = activeContainer.querySelector('[data-e2e*="like"], button[aria-label*="like"], button[aria-label*="thích"]');
        if (likeActionEl) {
          const textEl = likeActionEl.querySelector('strong, span, [class*="Count"]') || likeActionEl.nextElementSibling;
          if (textEl && textEl.textContent) {
            const val = parseHumanNumber(textEl.textContent);
            if (val > 0) likes = val;
          }
        }
      }

      // 3. Scrape Comments (skip if story mode, since stories use private DMs)
      if (!isStoryMode) {
        const commentButtons = statsRoot.querySelectorAll(
          'button[aria-label*="bình luận"], button[aria-label*="comment"], [data-e2e="comment-count"], [data-e2e="browse-comment-count"]'
        );
        for (const btn of commentButtons) {
          if (btn.offsetParent !== null) {
            // Like counts, comment counts and their data-e2e attributes are
            // commonly attached to the count element itself on Home.
            const directCount = parseHumanNumber(btn.textContent);
            if (directCount > 0) {
              comments = directCount;
              break;
            }
            const aria = btn.getAttribute('aria-label') || '';
            const m = aria.match(/(\d[\d.,]*\s*[KMBkmb]?)\s*(?:bình luận|comments|comment)/i);
            if (m) {
              comments = parseHumanNumber(m[1]);
              break;
            }
            const strong = btn.querySelector('strong, span');
            if (strong && strong.textContent) {
              const val = parseHumanNumber(strong.textContent);
              if (val > 0) {
                comments = val;
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[TikTok Toolkit] scrapeDOMStats error:', e);
    }

    return { views, likes, comments, shares, isStoryMode };
  }

  // Check if current page is Profile Overview without any active/visible video or story modal
  function isProfileOverview() {
    const pathname = window.location.pathname;
    const isProfilePath = Boolean(pathname.match(/^\/@[\w.-]+\/?$/));
    if (!isProfilePath) return false;

    // If URL contains explicit post types, it's not profile overview
    if (pathname.includes('/video/') || pathname.includes('/photo/') || pathname.includes('/story/')) {
      return false;
    }

    // If there is any VISIBLE modal dialog (video popup or story viewer), it's not profile overview
    const visibleDialog = Array.from(document.querySelectorAll('div[role="dialog"], [data-e2e="browse-video"]')).find(el => {
      return el.offsetParent !== null && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden';
    });
    if (visibleDialog) return false;

    // Check if Story player is visible
    const storyEl = document.querySelector('div[class*="StoryProgress"], [data-e2e="story-author-name"], input[placeholder*="Nhắn tin"], input[placeholder*="Message"]');
    if (storyEl && storyEl.offsetParent !== null) return false;

    return true;
  }

  function readPostIdFromReactProps(value, depth = 0, seen = new Set(), inItemData = false) {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return '';
    seen.add(value);

    const idKeys = ['awemeId', 'aweme_id', 'itemId', 'item_id', 'videoId', 'video_id', 'postId', 'post_id'];
    for (const key of idKeys) {
      const candidate = value[key];
      if ((typeof candidate === 'string' || typeof candidate === 'number') && /^\d{15,25}$/.test(String(candidate))) {
        return String(candidate);
      }
    }
    if (inItemData && (typeof value.id === 'string' || typeof value.id === 'number') && /^\d{15,25}$/.test(String(value.id))) {
      return String(value.id);
    }

    const nestedKeys = ['item', 'itemInfo', 'itemStruct', 'aweme', 'video', 'post', 'media', 'props', 'memoizedProps', 'pendingProps', 'data', 'children'];
    for (const key of nestedKeys) {
      const nested = value[key];
      if (!nested || typeof nested !== 'object') continue;
      const nextItemContext = inItemData || /item|aweme|post|video/i.test(key);
      if (Array.isArray(nested)) {
        for (const child of nested.slice(0, 8)) {
          const id = readPostIdFromReactProps(child, depth + 1, seen, nextItemContext);
          if (id) return id;
        }
      } else {
        const id = readPostIdFromReactProps(nested, depth + 1, seen, nextItemContext);
        if (id) return id;
      }
    }
    return '';
  }

  function getPostIdFromReactTree(element) {
    let node = element;
    for (let level = 0; node && level < 10; level++, node = node.parentElement) {
      for (const key of Object.keys(node)) {
        if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
        let reactNode = node[key];
        for (let fiberLevel = 0; reactNode && fiberLevel < 8; fiberLevel++) {
          const id = readPostIdFromReactProps(reactNode.memoizedProps || reactNode.pendingProps || reactNode);
          if (id) return id;
          reactNode = reactNode.return;
        }
      }
    }
    return '';
  }

  function getPostIdFromFeedColumn(column) {
    if (!column) return '';
    const candidates = column.querySelectorAll(
      '[data-e2e="like-count"], [data-e2e="comment-count"], [data-e2e="share-count"], a[href^="/@"]'
    );
    for (const candidate of candidates) {
      // The active Home player's React component can hold the full item data
      // even when its feed response was missed by the MAIN-world interceptor.
      // Seed our stats cache directly from that item before falling back to ID.
      const reactItem = getItemFromReactTree(candidate);
      if (reactItem) {
        registerItem(reactItem, 'active_feed_react');
        return String(reactItem.id || reactItem.aweme_id || reactItem.itemId || reactItem.video?.id || '');
      }
      const id = getPostIdFromReactTree(candidate);
      if (id) return id;
    }
    return '';
  }

  function getItemFromReactTree(element) {
    let node = element;
    for (let level = 0; node && level < 10; level++, node = node.parentElement) {
      for (const key of Object.keys(node)) {
        if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
        let reactNode = node[key];
        for (let fiberLevel = 0; reactNode && fiberLevel < 10; fiberLevel++) {
          const props = reactNode.memoizedProps || reactNode.pendingProps || reactNode;
          const possibleItems = [
            props?.item,
            props?.itemInfo?.itemStruct,
            props?.itemStruct,
            props?.aweme
          ];
          for (const item of possibleItems) {
            if (!item || typeof item !== 'object') continue;
            const id = String(item.id || item.aweme_id || item.itemId || item.video?.id || '');
            if (/^\d{15,25}$/.test(id) && item.stats && typeof item.stats === 'object') return item;
          }
          reactNode = reactNode.return;
        }
      }
    }
    return null;
  }

  // Comprehensive Current Media Resolver (supports /video/, /photo/, /story/)
  function resolveCurrentMedia(contextEl = null) {
    activeMediaContainer = null;
    // If on profile overview page and no modal is open, return no active media
    if (isProfileOverview()) {
      return { id: null, media: null, isPhoto: false, isStory: false, isProfileOverview: true };
    }

    let resolvedId = null;
    let isPhoto = false;
    let isStory = false;

    // Check Story indicators (URL or visible story viewer elements)
    if (
      window.location.href.includes('/story/') ||
      document.querySelector('[data-e2e="story-author-name"], div[class*="StoryProgress"], input[placeholder*="Nhắn tin"]')
    ) {
      isStory = true;
    }

    // Strategy 1: Check link text elements and copy inputs in visible dialog
    const copyElements = Array.from(document.querySelectorAll('input, p[class*="PCopyLinkText"], [class*="CopyLinkText"], [class*="CopyLink"]'));
    for (const el of copyElements) {
      if (el.offsetParent === null) continue; // Skip hidden elements from closed modals
      const val = el.value || el.textContent || el.getAttribute('value') || '';
      if (val.includes('tiktok.com/@') || val.includes('/video/') || val.includes('/photo/') || val.includes('/story/')) {
        const m = val.match(/\/(video|photo|story)\/(\d+)/);
        if (m) {
          resolvedId = m[2];
          if (m[1] === 'photo') isPhoto = true;
          if (m[1] === 'story') isStory = true;
          break;
        }
      }
    }

    // Strategy 2: Check window.location
    if (!resolvedId) {
      const locMatch = window.location.href.match(/\/(video|photo|story)\/(\d+)/);
      if (locMatch) {
        resolvedId = locMatch[2];
        if (locMatch[1] === 'photo') isPhoto = true;
        if (locMatch[1] === 'story') isStory = true;
      }
    }

    // Strategy 3: Check contextEl or active visible modal dialog
    if (!resolvedId) {
      const visibleModal = contextEl?.closest('div[role="dialog"], [data-e2e="browse-video"], [data-e2e="feed-item"]') ||
        Array.from(document.querySelectorAll('div[role="dialog"], [data-e2e="browse-video"]')).find(el => {
          return el.offsetParent !== null && window.getComputedStyle(el).display !== 'none';
        });
      if (visibleModal) {
        activeMediaContainer = visibleModal;
        const link = visibleModal.querySelector('a[href*="/video/"], a[href*="/photo/"], a[href*="/story/"]');
        if (link) {
          const href = link.getAttribute('href') || link.href || '';
          const m = href.match(/\/(video|photo|story)\/(\d+)/);
          if (m) {
            resolvedId = m[2];
            if (m[1] === 'photo') isPhoto = true;
            if (m[1] === 'story') isStory = true;
          }
        }
      }
    }

    // Strategy 4: Check active playing <video> (skip if photo mode)
    if (!resolvedId && !isPhoto) {
      const activeVideos = Array.from(document.querySelectorAll('video'))
        .filter(video => {
          if (video.offsetParent === null || (video.paused && video.readyState < 2)) return false;
          const rect = video.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        })
        .sort((a, b) => {
          const score = video => {
            const rect = video.getBoundingClientRect();
            return (video.paused ? 0 : 1e9) + rect.width * rect.height;
          };
          return score(b) - score(a);
        });

      for (const activeVideo of activeVideos) {
        // TikTok changes feed wrapper names often. Walk a few ancestors and
        // look for the post link near the actual playing media instead.
        let node = activeVideo;
        for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
          const link = node.matches?.('a[href*="/video/"], a[href*="/photo/"], a[href*="/story/"]')
            ? node
            : node.querySelector?.('a[href*="/video/"], a[href*="/photo/"], a[href*="/story/"]');
          if (!link) continue;
          const href = link.getAttribute('href') || link.href || '';
          const match = href.match(/\/(video|photo|story)\/(\d+)/);
          if (!match) continue;
          resolvedId = match[2];
          activeMediaContainer = node;
          if (match[1] === 'photo') isPhoto = true;
          if (match[1] === 'story') isStory = true;
          break;
        }
        if (resolvedId) break;
      }

      // Match the active player to intercepted feed data when TikTok renders
      // the player without a post link in its surrounding DOM.
      if (!resolvedId && activeVideos.length) {
        const activeVideo = activeVideos[0];
        // On the Home feed, TikTok places the player inside an article while
        // the engagement counts, author and caption live in the surrounding
        // anchoring-player-column. Use that whole column as the active item
        // scope so both item matching and DOM stats see the current post.
        activeMediaContainer = activeVideo.closest('[data-e2e="anchoring-player-column"]') ||
          activeVideo.closest('[data-e2e="recommend-list-item-container"], [data-e2e="feed-item"], [data-e2e="user-post-item"], article') ||
          activeVideo.parentElement?.parentElement || activeVideo.parentElement;
        resolvedId = getPostIdFromReactTree(activeMediaContainer || activeVideo);
        if (!resolvedId && activeMediaContainer?.matches?.('[data-e2e="anchoring-player-column"]')) {
          resolvedId = getPostIdFromFeedColumn(activeMediaContainer);
        }
        const currentSource = activeVideo.currentSrc || activeVideo.src || '';
        if (!resolvedId && currentSource && !currentSource.startsWith('blob:')) {
          let sourcePath = currentSource;
          try { sourcePath = new URL(currentSource, location.href).pathname; } catch (e) { }
          for (const item of itemsMap.values()) {
            if (!item.videoUrl) continue;
            let itemPath = item.videoUrl;
            try { itemPath = new URL(item.videoUrl, location.href).pathname; } catch (e) { }
            if (sourcePath === itemPath) {
              resolvedId = item.id;
              break;
            }
          }
        }

        // Blob-backed players may not expose their CDN URL. Use the creator
        // link and caption around this player only when that identifies one item.
        if (!resolvedId) {
          const creatorLink = activeMediaContainer?.querySelector?.('a[href^="/@"]');
          const creator = (creatorLink?.getAttribute('href') || '').match(/^\/@([^/?#]+)/)?.[1]?.toLowerCase() || '';
          const cardText = (activeMediaContainer?.textContent || '').toLowerCase();
          const creatorItems = creator ? Array.from(itemsMap.values()).filter(item => item.author?.uniqueId?.toLowerCase() === creator) : [];
          const captionMatch = creatorItems.find(item => item.desc && item.desc.length > 12 && cardText.includes(item.desc.toLowerCase().slice(0, 48)));
          if (captionMatch) resolvedId = captionMatch.id;
        }
      }
    }

    // Home, Following and Friends use different wrappers for their current
    // feed post. Resolve the playing video first, then its own controls, so
    // each feed's active item is kept in sync while scrolling.
    const isTikTokFeedRoute = ['/', '/following', '/friends'].includes(window.location.pathname);
    if (!isStory && isTikTokFeedRoute) {
      const homeColumn = window.location.pathname === '/'
        ? document.querySelector('[data-e2e="anchoring-player-column"]')
        : null;
      const activeVideo = Array.from(document.querySelectorAll('video'))
        .filter(video => {
          const rect = video.getBoundingClientRect();
          return !video.paused && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
        })
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        })[0];
      const feedContainer = homeColumn && homeColumn.offsetParent !== null
        ? homeColumn
        : activeVideo?.closest('[data-e2e="recommend-list-item-container"], [data-e2e="feed-item"], [data-e2e="user-post-item"], article');

      if (feedContainer && feedContainer.offsetParent !== null) {
        activeMediaContainer = feedContainer;
        const feedItemId = getPostIdFromFeedColumn(feedContainer);
        if (feedItemId) {
          resolvedId = feedItemId;
          isPhoto = false;
          isStory = false;
        }

        const currentAuthor = (feedContainer.querySelector('a[href^="/@"]')?.getAttribute('href') || '')
          .match(/^\/@([^/?#]+)/)?.[1]?.toLowerCase() || '';
        const bridgedItem = activeFeedItemFromMainWorld;
        const bridgeMatchesCurrent = Boolean(
          bridgedItem?.id &&
          Date.now() - bridgedItem.receivedAt < 5000 &&
          (!currentAuthor || !bridgedItem.author || bridgedItem.author === currentAuthor)
        );
        if (bridgeMatchesCurrent) {
          resolvedId = bridgedItem.id;
          isPhoto = false;
          isStory = false;
        } else {
          window.postMessage({ source: 'TIKTOK_TOOLKIT_CONTENT', type: 'REQUEST_ACTIVE_FEED_ITEM' }, '*');
        }
      }
    }

    // Check Photo indicators from DOM
    if (!isPhoto && (
      window.location.href.includes('/photo/') ||
      Boolean(document.querySelector('div[class*="DivPhotoSlide"], img[src*="photomode"]'))
    )) {
      isPhoto = true;
    }

    // Strategy 5: Query itemsMap
    let media = resolvedId ? itemsMap.get(String(resolvedId)) : null;

    // Special handler for Story (Match by current author or create clean stub - NEVER use random last item!)
    if (isStory) {
      const currentUsername = window.location.pathname.replace(/^\/@/, '').split('/')[0].toLowerCase();
      if (!media && currentUsername) {
        for (const item of itemsMap.values()) {
          if (item.isStory && item.author?.uniqueId && item.author.uniqueId.toLowerCase() === currentUsername) {
            media = item;
            resolvedId = item.id;
            break;
          }
        }
      }
      if (!media) {
        media = {
          id: resolvedId || 'story_active',
          author: { uniqueId: currentUsername || 'tiktok_user' },
          stats: { playCount: 0, diggCount: 0, commentCount: 0 },
          isStory: true,
          isPhotoMode: isPhoto,
          images: [],
          videoUrl: ''
        };
      }
    }

    // Fallback: If resolvedId found but not in itemsMap yet, create clean stub (NEVER pick random item from previous session!)
    if (!media && resolvedId) {
      media = {
        id: resolvedId,
        author: { uniqueId: 'tiktok_user' },
        stats: { playCount: 0, diggCount: 0, commentCount: 0 },
        isStory: isStory,
        isPhotoMode: isPhoto,
        images: [],
        videoUrl: ''
      };
    }

    if (!activeMediaContainer && resolvedId) {
      activeMediaContainer = document.querySelector('[data-e2e="browse-video"], div[role="dialog"]') || null;
    }

    if (media) {
      if (isPhoto) media.isPhotoMode = true;
      if (isStory) media.isStory = true;
      if (!isPhoto && !media.videoUrl && lastCapturedStreamUrl) {
        media.videoUrl = lastCapturedStreamUrl;
      }
    }

    if (resolvedId && !isStory) requestCurrentItemDetails(resolvedId);

    // Explicit /@user/video/{id} pages render their counters from a React
    // item outside the Home feed column. Ask MAIN world for that exact ID when
    // the extension's intercepted feed/detail cache has no view count.
    const explicitVideoId = window.location.pathname.match(/\/@[^/]+\/video\/(\d+)/)?.[1] || '';
    if (explicitVideoId && !isStory && !itemsMap.get(explicitVideoId)?.stats?.playCount) {
      window.postMessage({
        source: 'TIKTOK_TOOLKIT_CONTENT',
        type: 'REQUEST_ACTIVE_FEED_ITEM',
        itemId: explicitVideoId
      }, '*');
    }

    return { id: resolvedId || media?.id || null, media: media, isPhoto, isStory, isProfileOverview: false };
  }

  // Button state controller: prevents spam, shows real-time progress & status
  let isDownloadInProgress = false;
  let resetBtnTimer = null;
  let downloadSafetyWatchdog = null;

  function setButtonState(state, text, percent = null) {
    const dlBtn = document.getElementById('tk-btn-widget-download');
    const dlText = document.getElementById('tk-btn-widget-dl-text');
    const progWrap = document.getElementById('tk-pro-progress-wrap');
    const progBar = document.getElementById('tk-pro-progress-bar');
    const progText = document.getElementById('tk-pro-progress-text');

    if (!dlBtn || !dlText) return;

    if (resetBtnTimer) {
      clearTimeout(resetBtnTimer);
      resetBtnTimer = null;
    }

    dlBtn.classList.remove('loading', 'success', 'error');

    if (state === 'loading') {
      isDownloadInProgress = true;
      dlBtn.classList.add('loading');
      dlText.textContent = text;
      if (progWrap) {
        progWrap.style.display = 'block';
        if (percent !== null) {
          const clamped = Math.max(0, Math.min(100, Math.round(percent)));
          if (progBar) progBar.style.width = clamped + '%';
          if (progText) progText.textContent = clamped + '%';
        }
      }

      // Allow long ZIP jobs to keep their progress visible, while clearing stalled jobs eventually.
      if (downloadSafetyWatchdog) clearTimeout(downloadSafetyWatchdog);
      downloadSafetyWatchdog = setTimeout(() => {
        if (isDownloadInProgress) {
          console.warn('[TikTok Toolkit] Download safety watchdog triggered');
          resetButtonState();
        }
      }, 300000);
    } else if (state === 'success') {
      isDownloadInProgress = false;
      if (downloadSafetyWatchdog) {
        clearTimeout(downloadSafetyWatchdog);
        downloadSafetyWatchdog = null;
      }
      dlBtn.classList.add('success');
      dlText.textContent = text;
      if (progWrap) {
        if (progBar) progBar.style.width = '100%';
        if (progText) progText.textContent = '100%';
      }
      resetBtnTimer = setTimeout(resetButtonState, 3500);
    } else if (state === 'error') {
      isDownloadInProgress = false;
      if (downloadSafetyWatchdog) {
        clearTimeout(downloadSafetyWatchdog);
        downloadSafetyWatchdog = null;
      }
      dlBtn.classList.add('error');
      dlText.textContent = text;
      resetBtnTimer = setTimeout(resetButtonState, 3500);
    } else {
      resetButtonState();
    }
  }

  function resetButtonState() {
    isDownloadInProgress = false;
    if (downloadSafetyWatchdog) {
      clearTimeout(downloadSafetyWatchdog);
      downloadSafetyWatchdog = null;
    }
    if (resetBtnTimer) {
      clearTimeout(resetBtnTimer);
      resetBtnTimer = null;
    }
    const dlBtn = document.getElementById('tk-btn-widget-download');
    const progWrap = document.getElementById('tk-pro-progress-wrap');
    const progBar = document.getElementById('tk-pro-progress-bar');
    if (dlBtn) {
      dlBtn.classList.remove('loading', 'success', 'error');
    }
    if (progWrap) {
      progWrap.style.display = 'none';
      if (progBar) progBar.style.width = '0%';
    }
    updateWidgetDownloadButton();
  }

  // Multi-Level Fallback Video Downloader (with button notification & progress)
  async function downloadVideo(media, itemId) {
    if (isDownloadInProgress) return;

    try {
      setButtonState('loading', '⏳ Đang lấy link video HD...', 20);

      let videoUrl = '';
      if (media?.videoUrl && isActualVideoUrl(media.videoUrl)) {
        videoUrl = cleanMediaUrl(media.videoUrl);
      }
      if (!videoUrl && lastCapturedStreamUrl && isActualVideoUrl(lastCapturedStreamUrl)) {
        videoUrl = cleanMediaUrl(lastCapturedStreamUrl);
      }
      if (!videoUrl && itemId) {
        const cached = itemsMap.get(String(itemId));
        if (cached?.videoUrl && isActualVideoUrl(cached.videoUrl)) {
          videoUrl = cleanMediaUrl(cached.videoUrl);
        }
      }
      if (!videoUrl && media) {
        videoUrl = findAnyMediaUrl(media);
      }
      if (!videoUrl && itemId) {
        try {
          const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (el && el.textContent) {
            const raw = el.textContent;
            const reg = new RegExp(`"${itemId}"[\\s\\S]*?"playAddr":\\s*"([^"]+)"`);
            let match = raw.match(reg);
            if (!match) {
              match = raw.match(/"playAddr":\s*"([^"]+)"/) || raw.match(/"play_addr":\s*"([^"]+)"/);
            }
            if (match && match[1]) {
              const candidate = cleanMediaUrl(match[1]);
              if (isActualVideoUrl(candidate)) videoUrl = candidate;
            }
          }
        } catch (e) { }
      }
      if (!videoUrl) {
        const vids = Array.from(document.querySelectorAll('video'));
        const activeVideo = vids.find(v => !v.paused && v.currentTime > 0) || vids[0];
        if (activeVideo && activeVideo.src && !activeVideo.src.startsWith('blob:') && isActualVideoUrl(activeVideo.src)) {
          videoUrl = cleanMediaUrl(activeVideo.src);
        }
      }
      if (!videoUrl && itemId) {
        try {
          setButtonState('loading', '⏳ Đang kết nối máy chủ...', 40);
          const resp = await fetch(`https://www.tiktok.com/api/item/detail/?itemId=${itemId}`, {
            credentials: 'include'
          });
          if (resp.ok) {
            const json = await resp.json();
            const itemStruct = json?.itemInfo?.itemStruct || json?.itemStruct;
            if (itemStruct) {
              const candidate = extractVideoUrl(itemStruct.video || itemStruct);
              if (isActualVideoUrl(candidate)) {
                videoUrl = candidate;
                registerItem(itemStruct, 'direct_fetch');
              }
            }
          }
        } catch (e) { }
      }

      if (!videoUrl || !isActualVideoUrl(videoUrl)) {
        window.postMessage({ source: 'TIKTOK_TOOLKIT_CONTENT', type: 'REQUEST_ALL_CACHED_ITEMS' }, '*');
        setButtonState('error', '⚠️ Hãy Play video 1s rồi bấm lại');
        return;
      }

      const filename = `tiktok_${media?.author?.uniqueId || 'video'}_${itemId || Date.now()}_HD.mp4`;
      setButtonState('loading', '🚀 Đang tải video HD...', 70);

      if (!isExtensionValid()) {
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setButtonState('success', '✅ Đã bắt đầu tải video HD!', 100);
        return;
      }

      let downloadResponded = false;
      const fallbackTimer = setTimeout(() => {
        if (!downloadResponded) {
          downloadResponded = true;
          setButtonState('success', '✅ Đã bắt đầu tải video HD!', 100);
        }
      }, 5000);

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: videoUrl,
        filename: filename
      }, (res) => {
        if (downloadResponded) return;
        downloadResponded = true;
        clearTimeout(fallbackTimer);
        if (chrome.runtime.lastError) {
          setButtonState('error', '❌ Lỗi kết nối nền');
          return;
        }
        if (res && res.success) {
          setButtonState('success', '✅ Đã bắt đầu tải video HD!', 100);
        } else {
          setButtonState('error', '❌ Lỗi: ' + (res?.error || 'Thử lại'));
        }
      });
    } catch (err) {
      console.error('[TikTok Toolkit] downloadVideo error:', err);
      setButtonState('error', '❌ Lỗi tải video');
    }
  }

  // Fast In-Browser Concurrent Photo ZIP Downloader (Bypasses ServiceWorker data-URL limits)
  async function downloadPhotos(media, itemId) {
    if (isDownloadInProgress) return;

    try {
      let imgUrls = media?.images || [];
      if (imgUrls.length === 0) {
        const domImgs = Array.from(document.querySelectorAll('img[src*="photomode"], div[class*="DivPhotoSlide"] img, img[src*="tos-"][src*="image"]'));
        imgUrls = domImgs
          .filter(img => (img.naturalWidth > 180 || img.width > 180 || img.src.includes('photomode')) && !img.src.includes('avatar') && !img.src.includes('logo'))
          .filter(img => !img.src.includes('zoomcover'))
          .map(img => img.src);
      }
      imgUrls = deduplicatePhotoUrls(imgUrls);

      if (imgUrls.length === 0) {
        setButtonState('error', '⚠️ Không tìm thấy ảnh trong bài');
        return;
      }

      const total = imgUrls.length;
      if (!autoZipPhotos) {
        let downloaded = 0;
        for (let index = 0; index < total; index++) {
          setButtonState('loading', `⏳ Đang tải ảnh (${index + 1}/${total})...`, Math.round((index / total) * 100));
          const buffer = await fetchImageBuffer(imgUrls[index]);
          if (!buffer) continue;
          const url = imgUrls[index].toLowerCase();
          const ext = url.includes('.png') ? 'png' : (url.includes('.webp') ? 'webp' : 'jpg');
          const blobUrl = URL.createObjectURL(new Blob([buffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }));
          const anchor = document.createElement('a');
          anchor.href = blobUrl;
          anchor.download = `tiktok_${itemId || Date.now()}_photo_${String(index + 1).padStart(2, '0')}.${ext}`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          downloaded++;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (downloaded === 0) setButtonState('error', '❌ Không tải được dữ liệu ảnh');
        else setButtonState('success', `✅ Đã tải ${downloaded}/${total} ảnh riêng lẻ!`, 100);
        return;
      }
      setButtonState('loading', `⏳ Chuẩn bị tải ${total} ảnh...`, 0);

      const ZipClass = window.SimpleZip || window.MiniZip || self.SimpleZip;
      if (!ZipClass) {
        setButtonState('error', '❌ Lỗi khởi tạo ZIP');
        return;
      }

      const zip = new ZipClass();
      let loadedCount = 0;

      // Helper to fetch buffer (direct with fallback to service worker)
      async function fetchImageBuffer(url) {
        try {
          const resp = await fetch(url, { mode: 'cors' });
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (buf && buf.byteLength > 100) return buf;
          }
        } catch (e) { }

        // Fallback: via service worker
        if (isExtensionValid()) {
          try {
            const bgRes = await new Promise((resolve) => {
              chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BUFFER', url: url }, resolve);
            });
            if (bgRes && bgRes.success && bgRes.base64) {
              const bin = atob(bgRes.base64);
              const bytes = new Uint8Array(bin.length);
              for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
              return bytes.buffer;
            }
          } catch (e) { }
        }
        return null;
      }

      // Limit photo downloads to two in-flight requests to reduce memory and CPU spikes.
      const concurrency = 2;
      let currentIndex = 0;

      async function worker() {
        while (currentIndex < imgUrls.length) {
          const index = currentIndex++;
          const u = imgUrls[index];
          const buf = await fetchImageBuffer(u);
          if (buf) {
            const ext = u.includes('.png') ? 'png' : (u.includes('.webp') ? 'webp' : 'jpg');
            const name = `photo_${String(index + 1).padStart(2, '0')}.${ext}`;
            zip.addFile(name, new Uint8Array(buf));
            loadedCount++;
          }
          const pct = Math.round((loadedCount / total) * 100);
          setButtonState('loading', `⏳ Đang tải ảnh (${loadedCount}/${total})...`, pct);
        }
      }

      const workers = [];
      for (let c = 0; c < Math.min(concurrency, total); c++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (loadedCount === 0) {
        setButtonState('error', '❌ Không tải được dữ liệu ảnh');
        return;
      }

      setButtonState('loading', '⏳ Đang nén file ZIP...', 95);

      try {
        const zipBlob = zip.generate();
        const blobUrl = URL.createObjectURL(zipBlob);
        const filename = `tiktok_${media?.author?.uniqueId || 'photos'}_${itemId || Date.now()}.zip`;

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

        setButtonState('success', `✅ Đã tải xong ${loadedCount} ảnh (.ZIP)!`, 100);
      } catch (zipErr) {
        setButtonState('error', '❌ Lỗi nén file ZIP');
      }
    } catch (err) {
      console.error('[TikTok Toolkit] downloadPhotos error:', err);
      setButtonState('error', '❌ Lỗi tải album ảnh');
    }
  }

  // Profile Downloader: Downloads all videos & photos from current channel
  async function triggerProfileDownload() {
    if (isDownloadInProgress) return;

    const pathname = window.location.pathname;
    const authorUsername = pathname.replace(/^\/@/, '').split('/')[0].toLowerCase();

    // Load the profile's lazy grid as we collect links so the ZIP includes
    // posts beyond the first viewport. Stop after several passes add nothing.
    const postList = [];
    const seenIds = new Set();
    const originalScrollY = window.scrollY;
    let quietPasses = 0;
    setButtonState('loading', '⏳ Đang tìm bài đăng của kênh...', 0);
    try {
      for (let pass = 0; pass < 40 && quietPasses < 4; pass++) {
        const beforeCount = postList.length;
        const postElements = document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]');
        for (const a of postElements) {
          const href = a.getAttribute('href') || a.href || '';
          const match = href.match(/\/(video|photo)\/(\d+)/);
          if (match && !seenIds.has(match[2])) {
            seenIds.add(match[2]);
            postList.push({ id: match[2], isPhoto: match[1] === 'photo', href });
          }
        }
        quietPasses = postList.length > beforeCount ? 0 : quietPasses + 1;
        setButtonState('loading', `⏳ Đã tìm thấy ${postList.length} bài...`, Math.min(20, Math.round((pass / 40) * 20)));
        if (quietPasses < 4) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
    } finally {
      window.scrollTo(0, originalScrollY);
    }

    // Also include any items in itemsMap for this author
    for (const [id, item] of itemsMap.entries()) {
      if (!seenIds.has(id)) {
        if (!item.author?.uniqueId || item.author.uniqueId.toLowerCase() === authorUsername) {
          seenIds.add(id);
          postList.push({
            id: id,
            isPhoto: Boolean(item.isPhotoMode),
            media: item
          });
        }
      }
    }

    if (postList.length === 0) {
      setButtonState('error', '⚠️ Chưa thấy bài, hãy lướt trang xuống!');
      return;
    }

    const ZipClass = window.SimpleZip || window.MiniZip || self.SimpleZip;
    if (!ZipClass) {
      setButtonState('error', '❌ Không khởi tạo được bộ ZIP');
      return;
    }

    const zip = new ZipClass();
    const total = postList.length;
    let addedFiles = 0;
    let completedPosts = 0;

    async function fetchAsset(url) {
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
      } catch (e) { }

      if (!isExtensionValid()) return null;
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BUFFER', url }, result => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(result);
          });
        });
        if (!response?.success || !response.base64) return null;
        const binary = atob(response.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      } catch (e) {
        return null;
      }
    }

    function addBlobToDownloads(blob) {
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `tiktok_${authorUsername}_channel.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }

    setButtonState('loading', `⏳ Đang gom ${total} bài vào một file ZIP...`, 0);
    try {
      for (let i = 0; i < total; i++) {
        const post = postList[i];
        let media = post.media || itemsMap.get(post.id);
        setButtonState('loading', `⏳ Đang xử lý bài ${i + 1}/${total}...`, Math.round((i / total) * 90));

        if (!media || (!media.videoUrl && !media.images?.length)) {
          try {
            const response = await fetch(`https://www.tiktok.com/api/item/detail/?itemId=${post.id}`, { credentials: 'include' });
            if (response.ok) {
              const json = await response.json();
              const item = json?.itemInfo?.itemStruct || json?.itemStruct || json?.aweme_detail;
              if (item) {
                registerItem(item, 'profile_download');
                media = itemsMap.get(post.id);
                if (media) post.isPhoto = media.isPhotoMode;
              }
            }
          } catch (e) { }
        }

        if (post.isPhoto || media?.isPhotoMode) {
          const imageUrls = media?.images || [];
          for (let imageIndex = 0; imageIndex < imageUrls.length; imageIndex++) {
            const bytes = await fetchAsset(imageUrls[imageIndex]);
            if (!bytes?.byteLength) continue;
            const url = imageUrls[imageIndex].toLowerCase();
            const extension = url.includes('.png') ? 'png' : (url.includes('.webp') ? 'webp' : 'jpg');
            zip.addFile(`${authorUsername}_${post.id}_photo_${String(imageIndex + 1).padStart(2, '0')}.${extension}`, bytes);
            addedFiles++;
          }
        } else {
          const videoUrl = media?.videoUrl || '';
          if (videoUrl && isActualVideoUrl(videoUrl)) {
            const bytes = await fetchAsset(videoUrl);
            if (bytes?.byteLength) {
              zip.addFile(`${authorUsername}_${post.id}.mp4`, bytes);
              addedFiles++;
            }
          }
        }

        completedPosts++;
      }

      if (addedFiles === 0) {
        setButtonState('error', '❌ Không tải được media nào để đóng ZIP');
        return;
      }

      setButtonState('loading', `⏳ Đang tạo ZIP (${addedFiles} tệp)...`, 95);
      addBlobToDownloads(zip.generate());
      setButtonState('success', `✅ Đã tải ZIP kênh: ${addedFiles} tệp từ ${completedPosts}/${total} bài`, 100);
    } catch (error) {
      console.error('[TikTok Toolkit] profile ZIP error:', error);
      setButtonState('error', '❌ Lỗi gom media thành ZIP');
    }
  }

  // Smart Unified Downloader: handles Single Video, Single Photo ZIP, or Full Profile
  function triggerSmartDownload(contextEl = null) {
    if (isDownloadInProgress) return;

    const current = resolveCurrentMedia(contextEl);
    if (current.isProfileOverview) {
      triggerProfileDownload();
      return;
    }
    if (!current.media) {
      showToast('⚠️ Vui lòng mở xem một video hoặc story để tải về.');
      return;
    }
    const { id, media, isPhoto } = current;
    const routeType = window.location.pathname.match(/\/(video|photo)\//)?.[1];
    const isActuallyPhoto = routeType === 'video' ? false : Boolean(
      routeType === 'photo' ||
      isPhoto ||
      (media?.isPhotoMode && !media?.videoUrl) ||
      (!media?.videoUrl && media?.images?.length > 0)
    );

    if (isActuallyPhoto) {
      downloadPhotos(media, id);
    } else {
      downloadVideo(media, id);
    }
  }

  // Trigger Video / Photo Download
  function triggerVideoDownload(contextEl = null) {
    triggerSmartDownload(contextEl);
  }

  // Trigger Photo ZIP Download
  function triggerZipDownload(contextEl = null) {
    triggerSmartDownload(contextEl);
  }

  // Format numbers for clean UI badges (e.g. 0, 95, 1.2K, 35.6K, 1.4M)
  function formatCompactNumber(num) {
    if (num === undefined || num === null || isNaN(num) || num < 0) return '---';
    const n = Number(num);
    if (n === 0) return '0';
    if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // Inject Likes (Số Tym) Badge on Profile Grid Items (only on profile pages, skips unchanged tiles)
  function injectGridLikesBadge() {
    if (!window.location.pathname.startsWith('/@')) return;

    const postItems = document.querySelectorAll(
      '[data-e2e="user-post-item"], div[class*="StyledDivContainerV2"], div[class*="DivContainer-"], div[class*="DivItemContainer"], div[class*="ThreeColumnContainer"] > div'
    );
    if (!postItems || postItems.length === 0) return;

    postItems.forEach(itemEl => {
      const linkEl = itemEl.matches('a[href*="/video/"], a[href*="/photo/"], a[href*="/story/"]') ?
        itemEl :
        itemEl.querySelector('a[href*="/video/"], a[href*="/photo/"], a[href*="/story/"], a[class*="AVideoContainer"]');
      if (!linkEl) return;

      const href = linkEl.getAttribute('href') || linkEl.href || '';
      const match = href.match(/\/(video|photo|story)\/(\d+)/);
      if (!match) return;

      const vidId = match[2];
      const media = itemsMap.get(vidId);
      const likesCount = (media?.stats?.diggCount !== undefined) ? media.stats.diggCount : null;
      const formattedLikes = (likesCount !== null) ? formatCompactNumber(likesCount) : '---';

      // Skip DOM modification if this tile was already set to the same value
      if (itemEl.dataset.tkLikes === formattedLikes) return;
      itemEl.dataset.tkLikes = formattedLikes;

      let badge = itemEl.querySelector('.tk-pro-grid-like-badge');
      if (!badge) {
        itemEl.classList.add('tk-pro-grid-tile');

        badge = document.createElement('div');
        badge.className = 'tk-pro-grid-like-badge';
        badge.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 48 48" fill="#fe2c55" style="display:inline-block; vertical-align:middle; margin-right:3px; flex-shrink:0;">
            <path d="M24 41.95L21.1 39.3C10.8 29.97 4 23.8 4 16.25C4 10.08 8.83 5.25 15 5.25C18.48 5.25 21.82 6.87 24 9.42C26.18 6.87 29.52 5.25 33 5.25C39.17 5.25 44 10.08 44 16.25C44 23.8 37.2 29.97 26.9 39.33L24 41.95Z"/>
          </svg>
          <span class="tk-pro-like-val">${formattedLikes}</span>
        `;
        itemEl.appendChild(badge);
      } else {
        const valEl = badge.querySelector('.tk-pro-like-val');
        if (valEl && valEl.textContent !== formattedLikes) {
          valEl.textContent = formattedLikes;
        }
      }

      if (likesCount !== null) {
        badge.title = `Tổng lượt thích: ${Number(likesCount).toLocaleString()} lượt thích`;
      }
    });
  }

  // Clean up any legacy injected buttons from TikTok's HTML
  function removeLegacyInjectedButtons() {
    document.querySelectorAll('.tk-pro-sidebar-download-btn, .tk-pro-grid-download-btn').forEach(el => el.remove());
  }

  // Update Widget Download Button text and appearance
  function updateWidgetDownloadButton(resolvedCurrent = null) {
    if (isDownloadInProgress) return; // Do not overwrite text during active download

    const dlBtn = document.getElementById('tk-btn-widget-download');
    const dlText = document.getElementById('tk-btn-widget-dl-text');
    if (!dlBtn || !dlText) return;

    const current = resolvedCurrent || resolveCurrentMedia();
    const media = current.media;
    const isProfile = current.isProfileOverview;

    // PROFILE MODE: Download Entire Channel
    if (isProfile) {
      dlBtn.classList.remove('photo-mode');
      dlBtn.classList.add('profile-mode');
      dlBtn.style.opacity = '1';
      dlBtn.style.cursor = 'pointer';
      setTextIfChanged(dlText, '📥 Tải Toàn Bộ Kênh');
      dlBtn.title = 'Bấm để tải về toàn bộ video và ảnh có trên trang cá nhân này';
      return;
    }

    dlBtn.classList.remove('profile-mode');

    if (!media) {
      dlBtn.classList.remove('photo-mode');
      dlBtn.style.opacity = '0.5';
      dlBtn.style.cursor = 'not-allowed';
      setTextIfChanged(dlText, 'Chọn Video / Story Để Tải');
      dlBtn.title = 'Vui lòng mở một video hoặc story để tải về';
      return;
    }

    dlBtn.style.opacity = '1';
    dlBtn.style.cursor = 'pointer';

    const isStory = Boolean(
      current.isStory ||
      media?.isStory ||
      window.location.href.includes('/story/') ||
      Boolean(document.querySelector('div[class*="StoryProgress"], [data-e2e="story-author-name"], input[placeholder*="Nhắn tin"]'))
    );

    const routeType = window.location.pathname.match(/\/(video|photo)\//)?.[1];
    const isPhoto = routeType === 'video' ? false : Boolean(
      routeType === 'photo' ||
      current.isPhoto ||
      (media?.isPhotoMode && !media?.videoUrl) ||
      (!media?.videoUrl && media?.images?.length > 0) ||
      Boolean(document.querySelector('div[class*="DivPhotoSlide"], img[src*="photomode"]'))
    );

    if (isPhoto) {
      dlBtn.classList.add('photo-mode');
      const count = (media?.images && media.images.length > 0) ? ` (${media.images.length} Ảnh)` : '';
      setTextIfChanged(dlText, `Tải Trọn Bộ Ảnh .ZIP${count}`);
      dlBtn.title = 'Tải toàn bộ ảnh chất lượng cao vào 1 file .ZIP';
    } else {
      dlBtn.classList.remove('photo-mode');
      setTextIfChanged(dlText, isStory ? 'Tải Story Video (.MP4)' : 'Tải Video HD (.MP4)');
      dlBtn.title = 'Tải video HD không watermark';
    }
  }

  // 6. Refresh Floating Widget Stats (Combines API + Realtime DOM Scraping)
  function refreshActiveMediaStats(resolvedCurrent = null) {
    try {
      const viewsEl = document.getElementById('tk-stat-views');
      const likesEl = document.getElementById('tk-stat-likes');
      const cmtEl = document.getElementById('tk-stat-comments');

      if (!viewsEl || !likesEl || !cmtEl) return;

      const current = resolvedCurrent || resolveCurrentMedia();
      const media = current?.media || null;
      const isProfile = Boolean(current?.isProfileOverview);

      let domStats = { views: 0, likes: 0, comments: 0, shares: 0, isStoryMode: false };
      try {
        domStats = scrapeDOMStats() || domStats;
      } catch (e) { }

      if (isProfile) {
        setTextIfChanged(viewsEl, '---', 'Đang ở trang cá nhân');
        setTextIfChanged(likesEl, '---', 'Đang ở trang cá nhân');
        setTextIfChanged(cmtEl, '---', 'Đang ở trang cá nhân');
        setStatsStatus('Mở video để xem số liệu.', 'idle');
        return;
      }

      if (!media && !activeMediaContainer) {
        setTextIfChanged(viewsEl, '---', 'Chưa xác định được bài đang xem');
        setTextIfChanged(likesEl, '---', 'Chưa xác định được bài đang xem');
        setTextIfChanged(cmtEl, '---', 'Chưa xác định được bài đang xem');
        setStatsStatus('Chưa nhận diện được bài đang xem.', 'idle');
        return;
      }

      // Feed counters can be visible before TikTok's item API data is mapped
      // to the active player. Keep the visible values instead of blanking all cells.
      if (!media) {
        setTextIfChanged(viewsEl, domStats.views > 0 ? Number(domStats.views).toLocaleString() : '---', 'Lượt xem đang hiển thị trên TikTok');
        setTextIfChanged(likesEl, domStats.likes > 0 ? Number(domStats.likes).toLocaleString() : '---', 'Lượt thích đang hiển thị trên TikTok');
        setTextIfChanged(cmtEl, domStats.comments > 0 ? Number(domStats.comments).toLocaleString() : '---', 'Bình luận đang hiển thị trên TikTok');
        setStatsStatus(
          domStats.views || domStats.likes || domStats.comments
            ? 'Đang đọc số liệu trực tiếp trên TikTok.'
            : 'Đang chờ TikTok hiển thị số liệu.',
          domStats.views || domStats.likes || domStats.comments ? 'ready' : 'loading'
        );
        return;
      }

      const isStory = Boolean(
        current.isStory ||
        media?.isStory ||
        domStats.isStoryMode ||
        window.location.href.includes('/story/') ||
        Boolean(document.querySelector('div[class*="StoryProgress"], [data-e2e="story-author-name"], input[placeholder*="Nhắn tin"]'))
      );

      const isPhoto = Boolean(
        current.isPhoto ||
        media?.isPhotoMode ||
        window.location.href.includes('/photo/') ||
        Boolean(document.querySelector('div[class*="DivPhotoSlide"], img[src*="photomode"]'))
      );

      // 1. Resolve Likes: prioritize live DOM scraped likes first!
      const resolvedLikes = (media?.stats?.diggCount > 0) ? media.stats.diggCount : (domStats.likes || 0);
      if (resolvedLikes > 0) {
        setTextIfChanged(likesEl, Number(resolvedLikes).toLocaleString(), `Tổng lượt thích: ${Number(resolvedLikes).toLocaleString()}`);
      } else if (isStory) {
        setTextIfChanged(likesEl, 'Ẩn (Riêng tư)', 'Lượt thích Story chỉ có người đăng mới có thể xem.');
      } else {
        setTextIfChanged(likesEl, '0', '');
      }

      // 2. Resolve Comments
      if (isStory) {
        setTextIfChanged(cmtEl, '0 (DM)', 'Story TikTok không có bình luận công khai, người xem gửi tin nhắn riêng (DM).');
      } else {
        const resolvedComments = (media?.stats?.commentCount > 0) ? media.stats.commentCount : (domStats.comments || 0);
        setTextIfChanged(cmtEl, Number(resolvedComments).toLocaleString(), `Tổng bình luận: ${Number(resolvedComments).toLocaleString()}`);
      }

      // 3. Resolve Views
      const resolvedViews = Number(media?.stats?.playCount > 0 ? media.stats.playCount : (domStats.views || 0));
      if (resolvedViews > 0) {
        setTextIfChanged(viewsEl, Number(resolvedViews).toLocaleString(), `Tổng số lượt xem: ${Number(resolvedViews).toLocaleString()}`);
      } else if (isStory) {
        setTextIfChanged(viewsEl, '---', 'TikTok không cung cấp số lượt xem cho Story này.');
      } else if (isPhoto) {
        setTextIfChanged(viewsEl, '---', 'TikTok không công khai lượt xem đối với bài đăng ảnh.');
      } else {
        setTextIfChanged(viewsEl, '---', '');
      }

      const hasAnyStats = Boolean(
        resolvedViews || resolvedLikes || media?.stats?.commentCount || domStats.comments
      );
      const detailState = current?.id ? requestedDetailIds.get(String(current.id)) : null;
      if (isPhoto && !resolvedViews) {
        setStatsStatus('Đã nhận số liệu; TikTok không công khai lượt xem ảnh.', 'unavailable');
      } else if (isStory && !resolvedViews) {
        setStatsStatus('TikTok không cung cấp lượt xem công khai cho Story này.', 'unavailable');
      } else if (hasAnyStats && !resolvedViews) {
        setStatsStatus('Đã nhận một phần số liệu; lượt xem chưa có.', 'unavailable');
      } else if (hasAnyStats) {
        setStatsStatus('Đã nhận số liệu bài đăng.', 'ready');
      } else if (detailState?.inFlight || detailState?.status === 'loading') {
        setStatsStatus('Đang lấy số liệu từ TikTok…', 'loading');
      } else if (detailState?.status === 'error') {
        setStatsStatus('Lỗi khi lấy số liệu. Thử tải lại trang.', 'error');
      } else if (detailState?.status === 'unavailable') {
        setStatsStatus('TikTok không trả số liệu cho bài đăng này.', 'unavailable');
      } else if (detailState?.status === 'loaded') {
        setStatsStatus('Đã nhận dữ liệu; các chỉ số hiện bằng 0.', 'ready');
      } else if (isStory) {
        setStatsStatus('TikTok không cung cấp đầy đủ số liệu Story.', 'unavailable');
      } else {
        setStatsStatus('Chưa có số liệu từ TikTok.', 'idle');
      }
    } catch (err) {
      console.warn('[TikTok Toolkit] refreshActiveMediaStats error:', err);
    }
  }

  // Make element draggable with smooth viewport bounding and persistence
  function makeDraggable(element, onSingleClick = null) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let hasMoved = false;

    // Restore saved position if available
    const savedPos = localStorage.getItem('__TK_TOOLKIT_POS__');
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        const maxLeft = Math.max(10, window.innerWidth - 70);
        const maxTop = Math.max(10, window.innerHeight - 70);
        const left = Math.min(Math.max(10, pos.left), maxLeft);
        const top = Math.min(Math.max(10, pos.top), maxTop);
        element.style.left = left + 'px';
        element.style.top = top + 'px';
        element.style.right = 'auto';
        element.style.bottom = 'auto';
      } catch (e) { }
    }

    function onDragStart(clientX, clientY, target) {
      if (target.closest('#tk-btn-minimize')) return false;

      const isMinimized = element.classList.contains('minimized');
      // When not minimized, only allow dragging via header
      if (!isMinimized && !target.closest('#tk-pro-widget-header')) {
        return false;
      }

      isDragging = true;
      hasMoved = false;
      startX = clientX;
      startY = clientY;

      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      element.style.left = initialLeft + 'px';
      element.style.top = initialTop + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      element.classList.add('dragging');
      return true;
    }

    function onDragMove(clientX, clientY) {
      if (!isDragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;

      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        hasMoved = true;
      }

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      const maxLeft = Math.max(10, window.innerWidth - element.offsetWidth - 10);
      const maxTop = Math.max(10, window.innerHeight - element.offsetHeight - 10);
      newLeft = Math.max(10, Math.min(newLeft, maxLeft));
      newTop = Math.max(10, Math.min(newTop, maxTop));

      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;
      element.classList.remove('dragging');

      if (hasMoved) {
        const rect = element.getBoundingClientRect();
        localStorage.setItem('__TK_TOOLKIT_POS__', JSON.stringify({
          left: Math.round(rect.left),
          top: Math.round(rect.top)
        }));
      } else if (typeof onSingleClick === 'function') {
        onSingleClick();
      }
    }

    element.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (onDragStart(e.clientX, e.clientY, e.target)) {
        function mm(me) { onDragMove(me.clientX, me.clientY); }
        function mu() {
          onDragEnd();
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
        }
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      }
    });

    element.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      if (touch && onDragStart(touch.clientX, touch.clientY, e.target)) {
        function tm(te) {
          const t = te.touches[0];
          if (t) onDragMove(t.clientX, t.clientY);
        }
        function te() {
          onDragEnd();
          document.removeEventListener('touchmove', tm);
          document.removeEventListener('touchend', te);
        }
        document.addEventListener('touchmove', tm, { passive: true });
        document.addEventListener('touchend', te);
      }
    }, { passive: true });
  }

  // 7. Mount Persistent Floating Widget
  function mountFloatingWidget() {
    const existing = document.getElementById('tk-pro-floating-widget');
    if (existing) {
      if (existing.dataset.tkVersion === '1.2.13') return;
      existing.remove();
    }

    const widget = document.createElement('div');
    widget.id = 'tk-pro-floating-widget';
    widget.dataset.tkVersion = '1.2.13';
    widget.innerHTML = `
      <div class="tk-pro-widget-header" id="tk-pro-widget-header">
        <div class="tk-pro-widget-title">
          <span>🎵</span>
          <span>TikTok Pro Toolkit</span>
          <span style="font-size:10px; color:#25f4ee; margin-left:6px; opacity:0.8; font-weight:normal;">v1.2.13</span>
        </div>
        <button class="tk-pro-widget-toggle-btn" id="tk-btn-minimize" title="Thu nhỏ thành icon tròn">—</button>
      </div>

      <div class="tk-pro-widget-body">
        <div class="tk-pro-stats-grid">
          <div class="tk-pro-stat-cell">
            <span class="tk-pro-stat-val views" id="tk-stat-views">---</span>
            <span class="tk-pro-stat-lbl">👁️ Views</span>
          </div>
          <div class="tk-pro-stat-cell">
            <span class="tk-pro-stat-val likes" id="tk-stat-likes">0</span>
            <span class="tk-pro-stat-lbl">❤️ Likes</span>
          </div>
          <div class="tk-pro-stat-cell">
            <span class="tk-pro-stat-val" id="tk-stat-comments">0</span>
            <span class="tk-pro-stat-lbl">💬 Cmt</span>
          </div>
        </div>
        <div class="tk-pro-stats-status" id="tk-pro-stats-status" role="status" aria-live="polite" data-state="idle">Đang chờ dữ liệu…</div>

        <!-- Smart Download Button inside Floating Widget -->
        <button class="tk-pro-widget-dl-btn" id="tk-btn-widget-download" title="Tải xuống Video HD, Album Ảnh ZIP hoặc Toàn bộ Kênh">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 16L7 11L8.4 9.55L11 12.15V4H13V12.15L15.6 9.55L17 11L12 16ZM6 20C5.45 20 4.979 19.804 4.587 19.412C4.195 19.02 3.999 18.549 4 18V15H6V18H18V15H20V18C20 18.55 19.804 19.021 19.412 19.413C19.02 19.805 18.549 20.001 18 20H6Z"/>
          </svg>
          <span id="tk-btn-widget-dl-text">Tải Về Máy</span>
        </button>

        <!-- Realtime Download Progress Bar -->
        <div class="tk-pro-progress-wrap" id="tk-pro-progress-wrap">
          <div class="tk-pro-progress-bar" id="tk-pro-progress-bar"></div>
          <div class="tk-pro-progress-text" id="tk-pro-progress-text">0%</div>
        </div>

        <div class="tk-pro-ghost-indicator" id="tk-ghost-toggle-row" title="Bật hoặc tắt chặn một số yêu cầu tracking Story đã biết">
          <span>👻 Ghost Mode Story:</span>
          <span class="tk-pro-ghost-tag" id="tk-ghost-tag">ĐANG BẬT</span>
        </div>
      </div>
    `;

    document.body.appendChild(widget);
    updateStatsVisibility();

    const minBtn = widget.querySelector('#tk-btn-minimize');

    function toggleMinimize(forceState = null) {
      const isCurrentlyMinimized = widget.classList.contains('minimized');
      const targetState = (forceState !== null) ? forceState : !isCurrentlyMinimized;

      if (targetState) {
        widget.classList.add('minimized');
        widget.title = 'Bấm để mở rộng TikTok Pro Toolkit';
      } else {
        widget.classList.remove('minimized');
        widget.title = '';
        const rect = widget.getBoundingClientRect();
        if (rect.right > window.innerWidth - 10) {
          widget.style.left = Math.max(10, window.innerWidth - 305) + 'px';
        }
        if (rect.bottom > window.innerHeight - 10) {
          widget.style.top = Math.max(10, window.innerHeight - rect.height - 10) + 'px';
        }
      }
      localStorage.setItem('__TK_TOOLKIT_MINIMIZED__', targetState ? '1' : '0');
    }

    minBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMinimize(true);
    });

    // Make widget draggable and single click on circle restores full view
    makeDraggable(widget, () => {
      if (widget.classList.contains('minimized')) {
        toggleMinimize(false);
      }
    });

    // Restore minimized state if previously minimized
    if (localStorage.getItem('__TK_TOOLKIT_MINIMIZED__') === '1') {
      widget.classList.add('minimized');
      widget.title = 'Bấm để mở rộng TikTok Pro Toolkit';
    }

    const dlBtn = widget.querySelector('#tk-btn-widget-download');
    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerSmartDownload(dlBtn);
      });
    }

    const ghostRow = widget.querySelector('#tk-ghost-toggle-row');
    if (ghostRow) {
      ghostRow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleGhostMode();
      });
    }

    updateGhostModeUI();
    updateWidgetDownloadButton();
  }

  function toggleGhostMode() {
    ghostModeActive = !ghostModeActive;
    if (isExtensionValid()) {
      try {
        chrome.storage?.local?.set({ ghostMode: ghostModeActive });
        chrome.runtime?.sendMessage({ action: 'TOGGLE_GHOST_MODE', enabled: ghostModeActive });
      } catch (e) { }
    }
    notifyMainWorldGhostMode(ghostModeActive);
    updateGhostModeUI();
    showToast(ghostModeActive ? '👻 Đã bật chặn tracking Story đã biết' : '⚠️ Đã tắt chặn tracking Story');
  }

  function updateGhostModeUI() {
    const tag = document.getElementById('tk-ghost-tag');
    if (tag) {
      tag.textContent = ghostModeActive ? 'ĐANG BẬT' : 'ĐÃ TẮT';
      tag.style.color = ghostModeActive ? '#25f4ee' : '#ff4757';
      tag.style.background = ghostModeActive ? 'rgba(37, 244, 238, 0.15)' : 'rgba(255, 71, 87, 0.15)';
      tag.style.borderColor = ghostModeActive ? 'rgba(37, 244, 238, 0.4)' : 'rgba(255, 71, 87, 0.4)';
    }
  }

  let lastResolvedId = null;
  let lastWidgetUpdateHref = '';

  // Poll lightly for SPA navigation and pause while this tab is hidden.
  function loop() {
    if (document.hidden) return; // Completely idle when tab is in background

    try {
      mountFloatingWidget();

      if (location.href !== lastUrl) {
        handleUrlChange();
        return;
      }

      // Zero-CPU optimization: if current media hasn't changed, skip heavy DOM scraping!
      const current = resolveCurrentMedia();
      const currentId = current?.id || (current.isProfileOverview ? '__PROFILE__' : null);

      if (currentId === lastResolvedId && location.href === lastWidgetUpdateHref) {
        refreshActiveMediaStats(current);
        return; // Refresh counters without rebuilding the widget state.
      }

      lastResolvedId = currentId;
      lastWidgetUpdateHref = location.href;

      refreshActiveMediaStats(current);
      updateWidgetDownloadButton(current);
    } catch (err) {
      console.warn('[TikTok Toolkit] loop tick error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loop);
  } else {
    loop();
  }

  // Keep a slower fallback in case TikTok changes the active card without
  // dispatching a navigation/playback event.
  if (window.__TIKTOK_TOOLKIT_LOOP_INTERVAL__) {
    clearInterval(window.__TIKTOK_TOOLKIT_LOOP_INTERVAL__);
  }
  window.__TIKTOK_TOOLKIT_LOOP_INTERVAL__ = setInterval(loop, 1000);

})();
