/**
 * TikTok PC Pro Toolkit - Injected Script (MAIN World)
 * Captures live playback stream URLs, intercepts all TikTok network responses
 * (including CSR feeds, story batches, and item details), maintains global media cache,
 * and intercepts all ByteDance TEA / Slardar / story tracking requests at the page level.
 */
(function () {
  if (window.__TIKTOK_PRO_INJECTED__) return;
  window.__TIKTOK_PRO_INJECTED__ = true;

  window.__TIKTOK_ITEMS_CACHE__ = new Map();
  window.__TIKTOK_LAST_STREAM_URL__ = '';
  let ghostModeActive = true;

  console.log('[TikTok Toolkit] MAIN World interceptor active.');

  function emit(type, payload) {
    try {
      window.postMessage({
        source: 'TIKTOK_TOOLKIT_MAIN',
        type: type,
        payload: payload
      }, '*');
    } catch (e) { }
  }

  // Check if a URL is a TikTok / ByteDance telemetry or story tracking endpoint
  function isTrackingEndpoint(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('mcs-') ||
      lower.includes('mcs.') ||
      lower.includes('/v1/list') ||
      lower.includes('screen_time') ||
      lower.includes('app_open_times') ||
      lower.includes('monitor_browser') ||
      lower.includes('mon-sg') ||
      lower.includes('mon.') ||
      lower.includes('mon-va') ||
      lower.includes('mssdk-') ||
      lower.includes('mssdk.') ||
      lower.includes('/web/report') ||
      lower.includes('story/ack') ||
      lower.includes('story/seen') ||
      lower.includes('story/view') ||
      lower.includes('aweme/v1/story/view') ||
      lower.includes('aweme/v1/story/ack') ||
      lower.includes('commit/item/view')
    );
  }

  // Fast check if URL is an item / feed payload API (skips video chunks and static assets)
  function isFeedOrItemApi(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.includes('/api/item/') ||
      url.includes('/api/recommend/') ||
      url.includes('/api/post/') ||
      url.includes('/api/story/') ||
      url.includes('/aweme/v1/feed/') ||
      url.includes('/aweme/v1/aweme/detail/')
    );
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

  // Permissive media URL validator
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

  // Parse item and extract all media, photos, stats
  // Don't let partial feed events overwrite real counts with temporary zeroes.
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

  function parseItem(item, context = '') {
    if (!item) return null;
    const id = String(item.id || item.aweme_id || item.itemId || item.video?.id || '');
    if (!id) return null;

    // Carousel photos with strict mirror deduplication
    const images = extractPhotosFromItem(item);

    const videoUrl = findAnyMediaUrl(item.video) || findAnyMediaUrl(item);
    const existing = window.__TIKTOK_ITEMS_CACHE__.get(id);

    // Multi-key stats resolver
    const playCount = resolveStatCount([
      item.stats?.playCount, item.stats?.viewCount, item.stats?.play_count, item.stats?.view_count,
      item.stats?.totalViewers, item.stats?.viewerCount,
      item.statsV2?.playCount, item.statsV2?.viewCount, item.statsV2?.play_count, item.statsV2?.view_count,
      item.statistics?.play_count, item.statistics?.playCount, item.statistics?.viewCount, item.statistics?.view_count,
      item.playCount, item.play_count, item.viewCount, item.view_count,
      item.story?.stats?.playCount, item.story?.stats?.viewCount, item.story?.viewCount
    ], existing?.stats?.playCount);

    const diggCount = resolveStatCount([
      item.stats?.diggCount, item.statsV2?.diggCount, item.statsV2?.digg_count,
      item.statistics?.digg_count, item.statistics?.diggCount
    ], existing?.stats?.diggCount);

    const commentCount = resolveStatCount([
      item.stats?.commentCount, item.statsV2?.commentCount, item.statsV2?.comment_count,
      item.statistics?.comment_count, item.statistics?.commentCount
    ], existing?.stats?.commentCount);

    const shareCount = resolveStatCount([
      item.stats?.shareCount, item.statsV2?.shareCount, item.statsV2?.share_count,
      item.statistics?.share_count, item.statistics?.shareCount
    ], existing?.stats?.shareCount);

    const isStory = Boolean(
      item.is_story ||
      item.story ||
      context.includes('story') ||
      context.includes('batch_story')
    );

    // TikTok includes image covers on ordinary videos too. A playable video
    // stream is stronger evidence than image metadata and must win here.
    const hasVideo = Boolean(videoUrl || item.video?.playAddr || item.video?.play_addr);
    const isPhotoMode = !hasVideo && images.length > 0;

    const parsed = {
      id: id,
      context: context,
      desc: item.desc || item.title || existing?.desc || '',
      author: {
        id: item.author?.id || item.author?.uid || existing?.author?.id || '',
        uniqueId: item.author?.uniqueId || item.author?.secUid || existing?.author?.uniqueId || '',
        nickname: item.author?.nickname || existing?.author?.nickname || '',
        avatar: item.author?.avatarThumb || item.author?.avatarMedium || existing?.author?.avatar || ''
      },
      stats: {
        playCount: playCount,
        diggCount: diggCount,
        commentCount: commentCount,
        shareCount: shareCount
      },
      isStory: isStory,
      isPhotoMode: isPhotoMode || (!hasVideo && Boolean(item.imagePostInfo?.images?.length || item.imagePost?.images?.length)),
      images: hasVideo ? [] : (images.length > 0 ? images : (existing?.images || [])),
      videoUrl: videoUrl || existing?.videoUrl || ''
    };

    // Bounded LRU cache (max 150 items to prevent memory leaks)
    if (window.__TIKTOK_ITEMS_CACHE__.size >= 150) {
      const oldestKey = window.__TIKTOK_ITEMS_CACHE__.keys().next().value;
      if (oldestKey) window.__TIKTOK_ITEMS_CACHE__.delete(oldestKey);
    }
    window.__TIKTOK_ITEMS_CACHE__.set(id, parsed);
    return parsed;
  }

  // Extract all items from any response payload
  function extractAllItems(data, source = '') {
    if (!data) return [];
    const items = [];

    // Case 1: Data is an Array of author batches (e.g. /api/story/batch/item_list/)
    if (Array.isArray(data)) {
      data.forEach(entry => {
        if (entry && typeof entry === 'object') {
          if (Array.isArray(entry.itemList)) {
            entry.itemList.forEach(i => {
              const p = parseItem(i, source);
              if (p) items.push(p);
            });
          } else if (Array.isArray(entry.items)) {
            entry.items.forEach(i => {
              const p = parseItem(i, source);
              if (p) items.push(p);
            });
          } else if (entry.id || entry.aweme_id) {
            const p = parseItem(entry, source);
            if (p) items.push(p);
          }
        }
      });
      return items;
    }

    // Case 2: Data is an Object
    if (typeof data === 'object') {
      // Unpack Batch Story Lists: { batchStoryItemLists: [ { itemList: [...] } ] }
      const batchStoryLists = data.batchStoryItemLists || data.batch_story_item_lists;
      if (Array.isArray(batchStoryLists)) {
        batchStoryLists.forEach(entry => {
          if (entry && typeof entry === 'object') {
            const list = entry.itemList || entry.items || entry.storyList || entry.stories;
            if (Array.isArray(list)) {
              list.forEach(i => {
                const p = parseItem(i, source + '_batch_story');
                if (p) items.push(p);
              });
            }
          }
        });
      }

      const arrayKeys = [
        'itemList', 'items', 'aweme_list', 'item_list',
        'stories', 'storyList', 'story_list', 'postList'
      ];
      for (const k of arrayKeys) {
        if (Array.isArray(data[k])) {
          data[k].forEach(i => {
            const p = parseItem(i, source);
            if (p) items.push(p);
          });
        }
      }

      // Nested userStory
      const nestedUserStory = data.userStory || data.user_story;
      if (nestedUserStory) {
        const nestedList = nestedUserStory.stories || nestedUserStory.itemList || nestedUserStory.items;
        if (Array.isArray(nestedList)) {
          nestedList.forEach(i => {
            const p = parseItem(i, source);
            if (p) items.push(p);
          });
        }
      }

      // Single item
      const single = data.itemInfo?.itemStruct || data.itemStruct || data.aweme_detail;
      if (single) {
        const p = parseItem(single, source);
        if (p) items.push(p);
      }
    }

    return items;
  }

  // Batch and debounce item emission to prevent postMessage floods
  let pendingItemsBatch = [];
  let emitBatchTimer = null;

  function scheduleEmitBatch(newItems) {
    for (const item of newItems) {
      pendingItemsBatch.push(item);
    }
    if (emitBatchTimer) return;
    emitBatchTimer = setTimeout(() => {
      emitBatchTimer = null;
      if (pendingItemsBatch.length > 0) {
        const batch = pendingItemsBatch;
        pendingItemsBatch = [];
        emit('ITEMS_COLLECTED', batch);
      }
    }, 100);
  }

  function handleData(data, source = '') {
    if (!data || typeof data !== 'object') return;

    const items = extractAllItems(data, source);
    if (items.length > 0) {
      scheduleEmitBatch(items);
    }
  }

  // Intercept stream media URLs directly during video/story playback (emit only on CHANGE, lightweight check)
  function checkMediaStreamUrl(url) {
    if (!url || typeof url !== 'string') return;
    if (!url.includes('.mp4') && !url.includes('/video/tos/') && !url.includes('mime_type=video_mp4') && !url.includes('playAddr')) return;
    const clean = cleanMediaUrl(url);
    if (isActualVideoUrl(clean)) {
      if (clean !== window.__TIKTOK_LAST_STREAM_URL__) {
        window.__TIKTOK_LAST_STREAM_URL__ = clean;
        emit('DIRECT_STREAM_CAPTURED', { url: clean });
      }
    }
  }

  // 1. Hook navigator.sendBeacon (Drop telemetry beacons silently)
  if (navigator && navigator.sendBeacon) {
    const origSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (ghostModeActive && isTrackingEndpoint(url)) {
        return true; // Fake success, drop packet
      }
      return origSendBeacon(url, data);
    };
  }

  // 2. Hook window.fetch (Drop telemetry & capture data/media)
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0]?.url) : '';
    if (url) checkMediaStreamUrl(url);

    if (ghostModeActive && isTrackingEndpoint(url)) {
      // Return 200 OK JSON to prevent TEA/Slardar SDK from retrying or failing
      return new Response(JSON.stringify({ status_code: 0, message: "ok" }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const res = await origFetch.apply(this, args);
    try {
      if (isFeedOrItemApi(url)) {
        res.clone().json().then(j => handleData(j, url)).catch(() => { });
      }
    } catch (e) { }
    return res;
  };

  // 3. Hook XMLHttpRequest
  const origOpen = window.XMLHttpRequest.prototype.open;
  const origSend = window.XMLHttpRequest.prototype.send;

  window.XMLHttpRequest.prototype.open = function (m, url, ...rest) {
    this._tkUrl = url;
    if (url) checkMediaStreamUrl(url);
    return origOpen.apply(this, [m, url, ...rest]);
  };

  window.XMLHttpRequest.prototype.send = function (...args) {
    if (ghostModeActive && isTrackingEndpoint(this._tkUrl)) {
      Object.defineProperty(this, 'readyState', { value: 4, writable: true });
      Object.defineProperty(this, 'status', { value: 200, writable: true });
      Object.defineProperty(this, 'statusText', { value: 'OK', writable: true });
      Object.defineProperty(this, 'responseText', { value: '{"status_code":0,"message":"ok","code":0,"data":{}}', writable: true });
      Object.defineProperty(this, 'response', { value: '{"status_code":0,"message":"ok","code":0,"data":{}}', writable: true });
      setTimeout(() => {
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
        if (typeof this.onload === 'function') this.onload();
      }, 0);
      return;
    }

    this.addEventListener('load', function () {
      try {
        if (isFeedOrItemApi(this._tkUrl)) {
          const j = JSON.parse(this.responseText);
          handleData(j, this._tkUrl);
        }
      } catch (e) { }
    });

    return origSend.apply(this, args);
  };

  // 4. Hook ByteDance event tracking globals (TEA SDK / Slardar) in window
  function hookTrackerGlobal(prop) {
    let internal = window[prop];
    try {
      Object.defineProperty(window, prop, {
        configurable: true,
        enumerable: true,
        get() {
          return internal;
        },
        set(fn) {
          if (typeof fn === 'function') {
            if (fn.__tk_wrapped__) {
              internal = fn;
              return;
            }
            const wrapper = function (...args) {
              if (ghostModeActive) {
                const evStr = (typeof args[0] === 'string' ? args[0] : (typeof args[1] === 'string' ? args[1] : '')).toLowerCase();
                if (
                  evStr.includes('story') ||
                  evStr.includes('play') ||
                  evStr.includes('view') ||
                  evStr.includes('show') ||
                  evStr.includes('stay') ||
                  evStr.includes('time') ||
                  evStr.includes('finish')
                ) {
                  return; // Silently suppress tracking event from TEA buffer
                }
              }
              return fn.apply(this, args);
            };
            wrapper.__tk_wrapped__ = true;
            internal = wrapper;
          } else {
            internal = fn;
          }
        }
      });
    } catch (e) { }
  }
  hookTrackerGlobal('tea');
  hookTrackerGlobal('collectEvent');
  hookTrackerGlobal('Slardar');

  // Initial SSR scan
  function scanSSR() {
    try {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (el && el.textContent) {
        const j = JSON.parse(el.textContent);
        const scope = j['__DEFAULT_SCOPE__'] || {};
        for (const k in scope) {
          handleData(scope[k], 'ssr_' + k);
        }
      }
    } catch (e) { }
  }
  scanSSR();

  // React item props are available only in MAIN world. Content scripts run in
  // an isolated world, so bridge the active feed item's parsed stats instead
  // of trying to read React's private DOM expandos from content.js.
  let lastActiveFeedItemSignature = '';
  let lastActiveFeedItemSentAt = 0;
  function getActiveFeedReactItem(targetItemId = '') {
    const targetId = String(targetItemId || '');
    let activeContainer = null;
    if (targetId) {
      // Explicit post pages can include several related videos; match the URL
      // ID against each React item so counters from a nearby card never win.
      activeContainer = document;
    } else {
      const column = document.querySelector('[data-e2e="anchoring-player-column"]');
      if (column && column.offsetParent !== null) {
        activeContainer = column;
      } else {
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
        activeContainer = activeVideo?.closest(
          '[data-e2e="recommend-list-item-container"], [data-e2e="feed-item"], [data-e2e="user-post-item"], article'
        ) || null;
      }
    }
    if (!activeContainer) return null;
    const candidates = activeContainer === document
      ? document.querySelectorAll('[data-e2e="like-count"], [data-e2e="comment-count"], [data-e2e="share-count"]')
      : activeContainer.querySelectorAll('[data-e2e="like-count"], [data-e2e="comment-count"], [data-e2e="share-count"], a[href^="/@"]');
    for (const candidate of candidates) {
      let node = candidate;
      for (let level = 0; node && level < 10; level++, node = node.parentElement) {
        for (const key of Object.keys(node)) {
          if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
          let reactNode = node[key];
          for (let fiberLevel = 0; reactNode && fiberLevel < 10; fiberLevel++) {
            const props = reactNode.memoizedProps || reactNode.pendingProps || reactNode;
            const possibleItems = [props?.item, props?.itemInfo?.itemStruct, props?.itemStruct, props?.aweme];
            for (const item of possibleItems) {
              if (!item || typeof item !== 'object' || !item.stats || typeof item.stats !== 'object') continue;
              const id = String(item.id || item.aweme_id || item.itemId || item.video?.id || '');
              if (/^\d{15,25}$/.test(id) && (!targetId || id === targetId)) return item;
            }
            reactNode = reactNode.return;
          }
        }
      }
    }
    return null;
  }

  // Listen for requests from content.js
  window.addEventListener('message', (e) => {
    if (e.data?.source !== 'TIKTOK_TOOLKIT_CONTENT') return;

    if (e.data?.type === 'SET_GHOST_MODE') {
      ghostModeActive = Boolean(e.data.enabled);
      console.log('[TikTok Toolkit] MAIN World Ghost Mode updated:', ghostModeActive);
    }

    if (e.data?.type === 'REQUEST_ALL_CACHED_ITEMS') {
      // Send at most the last 50 cached items to prevent massive IPC serialization freezes
      const all = Array.from(window.__TIKTOK_ITEMS_CACHE__.values()).slice(-50);
      emit('ITEMS_COLLECTED', all);
      if (window.__TIKTOK_LAST_STREAM_URL__) {
        emit('DIRECT_STREAM_CAPTURED', { url: window.__TIKTOK_LAST_STREAM_URL__ });
      }
    }

    if (e.data?.type === 'REQUEST_ACTIVE_FEED_ITEM') {
      const item = getActiveFeedReactItem(e.data?.itemId);
      if (item) {
        const parsed = parseItem(item, 'active_feed_react');
        if (parsed) {
          const signature = `${parsed.id}:${parsed.stats.playCount}:${parsed.stats.diggCount}:${parsed.stats.commentCount}`;
          const now = Date.now();
          // The content script's 1s polling can request repeatedly; emit only
          // when the item/counts change or at most once every 2 seconds.
          if (signature !== lastActiveFeedItemSignature || now - lastActiveFeedItemSentAt >= 2000) {
            lastActiveFeedItemSignature = signature;
            lastActiveFeedItemSentAt = now;
            emit('ACTIVE_FEED_ITEM', parsed);
          }
        }
      }
    }

    if (e.data?.type === 'CALL_MODIFY_PRIVACY') {
      const { itemId, visibility } = e.data;
      if (!/^\d+$/.test(String(itemId || '')) || !['0', '1', '2'].includes(String(visibility))) {
        emit('MODIFY_PRIVACY_RESULT', { success: false, error: 'ID hoặc trạng thái không hợp lệ.' });
        return;
      }
      (async () => {
        try {
          const apiUrl = `https://www.tiktok.com/api/item/modify/privacy/?itemId=${itemId}&visibility=${visibility}`;
          const r = await origFetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          });
          const d = await r.json().catch(() => ({}));
          emit('MODIFY_PRIVACY_RESULT', {
            itemId,
            success: r.ok && (d.statusCode === 0 || d.status_code === 0),
            response: d
          });
        } catch (err) {
          emit('MODIFY_PRIVACY_RESULT', { itemId, success: false, error: err.message });
        }
      })();
    }
  });

})();
