/**
 * Collections page — 큐레이터별 네이버 저장 폴더 지도 시각화.
 *
 * 메인 페이지와 동일한 지도+사이드바 레이아웃. 폴더 탭으로 폴더 전환,
 * 카테고리 칩 + NEW 토글로 필터, 정렬 셀렉트로 정렬.
 *
 * URL hash:
 *   #c=<curator-slug>             — 큐레이터 선택
 *   #c=<slug>&f=<share-id>        — 폴더까지 선택
 */

const CONFIG = {
  NAVER_MAPS_CLIENT_ID: '',
  GOOGLE_MAPS_API_KEY: '',
  DEFAULT_CENTER: { lat: 37.5665, lng: 126.978 },
  DEFAULT_ZOOM: 12,
};

const state = {
  index: null,
  curator: null,
  activeFolderId: null,
  activeCategory: null,
  newOnly: false,
  sortBy: 'added',
  filtered: [],
  selectedSid: null,
  map: null,
  mapProvider: null,
  markers: [],
};

// === Config / Data ===
function loadConfig() {
  return new Promise((resolve) => {
    const tag = document.querySelector('script[src="config.js"]');
    if (window.INSTA_MAP_CONFIG) {
      Object.assign(CONFIG, window.INSTA_MAP_CONFIG);
      resolve();
      return;
    }
    // config.js 가 비동기 로드인 경우 대비
    let waited = 0;
    const t = setInterval(() => {
      waited += 50;
      if (window.INSTA_MAP_CONFIG) {
        Object.assign(CONFIG, window.INSTA_MAP_CONFIG);
        clearInterval(t);
        resolve();
      } else if (waited > 1000) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });
}

async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// === Hash routing ===
function parseHash() {
  const m = window.location.hash.match(/#c=([\w-]+)(?:&f=([\w]+))?/);
  if (!m) return { slug: null, folderId: null };
  return { slug: m[1], folderId: m[2] || null };
}

function setHash(slug, folderId) {
  const next = folderId ? `#c=${slug}&f=${folderId}` : `#c=${slug}`;
  if (window.location.hash !== next) {
    history.replaceState(null, '', next);
  }
}

// === Map init (메인 페이지의 패턴 재사용) ===
function initNaverMap() {
  return new Promise((resolve, reject) => {
    if (!CONFIG.NAVER_MAPS_CLIENT_ID) return reject('no naver key');
    const script = document.getElementById('naver-maps-script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CONFIG.NAVER_MAPS_CLIENT_ID}`;
    script.onload = () => {
      try {
        state.map = new naver.maps.Map('map', {
          center: new naver.maps.LatLng(CONFIG.DEFAULT_CENTER.lat, CONFIG.DEFAULT_CENTER.lng),
          zoom: CONFIG.DEFAULT_ZOOM,
          zoomControl: true,
          zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER },
          scaleControl: false,
        });
        state.mapProvider = 'naver';
        resolve();
      } catch (e) { reject(e); }
    };
    script.onerror = () => reject('naver maps load failed');
  });
}

function initGoogleMap() {
  return new Promise((resolve, reject) => {
    if (!CONFIG.GOOGLE_MAPS_API_KEY) return reject('no google key');
    const script = document.getElementById('google-maps-script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_API_KEY}&language=ko`;
    script.onload = () => {
      try {
        state.map = new google.maps.Map(document.getElementById('map'), {
          center: CONFIG.DEFAULT_CENTER,
          zoom: CONFIG.DEFAULT_ZOOM,
        });
        state.mapProvider = 'google';
        state.infoWindow = new google.maps.InfoWindow();
        resolve();
      } catch (e) { reject(e); }
    };
    script.onerror = () => reject('google maps load failed');
  });
}

async function initMap() {
  try { await initNaverMap(); return; } catch (e) { console.log('naver:', e); }
  try { await initGoogleMap(); return; } catch (e) { console.log('google:', e); }
  document.getElementById('map').style.display = 'none';
  document.getElementById('map-fallback').style.display = 'flex';
}

// === Markers ===
function categoryColor(name) {
  if (!name) return '#757575';
  if (/한식|국밥|국수|찌개|전골|덮밥|순대|족발|보쌈|곰탕|설렁탕/.test(name)) return '#e65100';
  if (/일식|라멘|우동|소바|초밥|돈가스|규동/.test(name)) return '#2e7d32';
  if (/중식|중국/.test(name)) return '#c62828';
  if (/카페|디저트|베이커리|커피/.test(name)) return '#7b1fa2';
  if (/햄버거|피자|파스타|양식|이탈리아/.test(name)) return '#1565c0';
  if (/BAR|바|맥주|호프|와인|위스키|주점|포차/.test(name)) return '#5d4037';
  if (/멕시코|남미|타코/.test(name)) return '#ef6c00';
  if (/태국|베트남|아시아/.test(name)) return '#00838f';
  return '#616161';
}

function clearMarkers() {
  state.markers.forEach((m) => {
    if (state.mapProvider === 'naver') m.setMap(null);
    else if (state.mapProvider === 'google') m.setMap(null);
    if (m._infoWindow && m._infoWindow.close) m._infoWindow.close();
  });
  state.markers = [];
}

function infoContent(p) {
  const score = (typeof p.score === 'number' && p.score > 0) ? `★ ${p.score.toFixed(2)}` : '';
  const reviews = p.review_count ? `리뷰 ${p.review_count >= 1000 ? (p.review_count/1000).toFixed(1)+'k' : p.review_count}` : '';
  const micro = (p.micro_reviews || [])[0] || '';
  return `
    <div style="max-width:240px;font-family:-apple-system,sans-serif;padding:6px 4px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:3px;">
        ${p.name}${p.is_new ? ' <span style="background:#e1306c;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;">NEW</span>' : ''}
      </div>
      <div style="font-size:11px;color:#888;margin-bottom:3px;">
        ${p.category_name || ''} ${score ? `· <span style="color:#ff9800;font-weight:600;">${score}</span>` : ''} ${reviews ? '· ' + reviews : ''}
      </div>
      ${micro ? `<div style="font-size:12px;color:#333;padding:4px 6px;background:rgba(255,152,0,0.1);border-left:2px solid #ff9800;margin:3px 0;font-style:italic;">${micro}</div>` : ''}
      <div style="font-size:11px;color:#666;margin-bottom:3px;">${p.road_address || p.address || ''}</div>
      <a href="${p.naver_place_url}" target="_blank" rel="noopener" style="font-size:11px;color:#1ec800;text-decoration:none;">네이버 플레이스 →</a>
    </div>`;
}

function addNaverMarkers() {
  state.filtered.forEach((p) => {
    if (!p.lat || !p.lng) return;
    const sz = p.is_new ? 16 : 12;
    const color = categoryColor(p.category_name);
    const border = p.is_new ? '3px solid #e1306c' : '2px solid #fff';
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map: state.map,
      title: p.name,
      icon: {
        content: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:${border};box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        anchor: new naver.maps.Point(sz/2, sz/2),
      },
    });
    const iw = new naver.maps.InfoWindow({
      content: infoContent(p),
      borderWidth: 0, backgroundColor: '#fff',
      anchorSize: new naver.maps.Size(10, 10),
      pixelOffset: new naver.maps.Point(0, -4),
    });
    naver.maps.Event.addListener(marker, 'click', () => {
      state.markers.forEach((m) => m._infoWindow && m._infoWindow.getMap && m._infoWindow.close());
      iw.open(state.map, marker);
      selectPlace(p, { skipPan: true });
    });
    marker._infoWindow = iw;
    marker._sid = p.sid;
    state.markers.push(marker);
  });
}

function addGoogleMarkers() {
  state.filtered.forEach((p) => {
    if (!p.lat || !p.lng) return;
    const marker = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: state.map,
      title: p.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: categoryColor(p.category_name),
        fillOpacity: 1,
        strokeColor: p.is_new ? '#e1306c' : '#fff',
        strokeWeight: p.is_new ? 3 : 2,
        scale: p.is_new ? 9 : 7,
      },
    });
    marker.addListener('click', () => {
      state.infoWindow.setContent(infoContent(p));
      state.infoWindow.open(state.map, marker);
      selectPlace(p, { skipPan: true });
    });
    marker._sid = p.sid;
    state.markers.push(marker);
  });
}

function refreshMarkers() {
  clearMarkers();
  if (state.mapProvider === 'naver') addNaverMarkers();
  else if (state.mapProvider === 'google') addGoogleMarkers();
  fitBounds();
}

function fitBounds() {
  const pts = state.filtered.filter((p) => p.lat && p.lng);
  if (!pts.length || !state.map) return;
  if (state.mapProvider === 'naver') {
    const b = new naver.maps.LatLngBounds(
      new naver.maps.LatLng(Math.min(...pts.map((p) => p.lat)), Math.min(...pts.map((p) => p.lng))),
      new naver.maps.LatLng(Math.max(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lng))),
    );
    state.map.fitBounds(b, { top: 50, right: 50, bottom: 50, left: 50 });
  } else if (state.mapProvider === 'google') {
    const b = new google.maps.LatLngBounds();
    pts.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
    state.map.fitBounds(b, 50);
  }
}

function panToPlace(p) {
  if (!p.lat || !p.lng || !state.map) return;
  if (state.mapProvider === 'naver') {
    state.map.setZoom(15);
    state.map.panTo(new naver.maps.LatLng(p.lat, p.lng));
    state.markers.forEach((m) => m._infoWindow && m._infoWindow.getMap() && m._infoWindow.close());
    const m = state.markers.find((m) => m._sid === p.sid);
    if (m && m._infoWindow) m._infoWindow.open(state.map, m);
  } else if (state.mapProvider === 'google') {
    state.map.panTo({ lat: p.lat, lng: p.lng });
    state.map.setZoom(15);
    const m = state.markers.find((m) => m._sid === p.sid);
    if (m) {
      state.infoWindow.setContent(infoContent(p));
      state.infoWindow.open(state.map, m);
    }
  }
}

// === UI ===
function getActiveFolder() {
  return state.curator.folders.find((f) => f.share_id === state.activeFolderId) || state.curator.folders[0];
}

function renderCuratorSelect() {
  const sel = document.getElementById('curator-select');
  sel.innerHTML = state.index.curators
    .map((c) => `<option value="${c.slug}">${c.display_name}님의 컬렉션</option>`)
    .join('');
  sel.value = state.curator.slug;
  sel.addEventListener('change', () => { location.hash = `#c=${sel.value}`; });
}

function renderHeader() {
  document.getElementById('curator-meta').textContent =
    `${state.curator.display_name} · ${state.curator.total_places}곳 / ${state.curator.folder_count}개 폴더`;
}

function renderFolderTabs() {
  const wrap = document.getElementById('folder-tabs');
  // 폴더 탭 = (활성화 토글하는 div) + (외부 링크 a) 두 영역 분리.
  // 같은 카드 안에 있지만 클릭은 각자 처리해서, "탭 클릭=폴더 활성화" / "↗ 클릭=네이버에서 열기"가 명확.
  wrap.innerHTML = state.curator.folders
    .map((f) => {
      const active = f.share_id === state.activeFolderId;
      const newBadge = f.new_count > 0 ? `<span class="tab-new">+${f.new_count}</span>` : '';
      const externalLink = f.share_url
        ? `<a class="folder-tab-link" href="${f.share_url}" target="_blank" rel="noopener" title="네이버 지도에서 '${f.label}' 폴더 열기" aria-label="원본 폴더 열기">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
           </a>`
        : '';
      return `
        <div class="folder-tab ${active ? 'active' : ''}" data-id="${f.share_id}" role="tab" tabindex="0">
          <span class="folder-tab-label">${f.label}</span>
          <span class="tab-count">${f.place_count}</span>
          ${newBadge}
          ${externalLink}
        </div>`;
    })
    .join('');

  wrap.querySelectorAll('.folder-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      // 외부 링크 아이콘 클릭은 무시 (a 태그가 자체적으로 처리)
      if (e.target.closest('.folder-tab-link')) return;
      state.activeFolderId = tab.dataset.id;
      state.activeCategory = null;
      setHash(state.curator.slug, state.activeFolderId);
      renderFolderTabs();
      renderCategories();
      applyFilters();
    });
  });
}

function renderCategories() {
  const folder = getActiveFolder();
  const counts = new Map();
  folder.places.forEach((p) => {
    const c = p.category_name || '기타';
    counts.set(c, (counts.get(c) || 0) + 1);
  });
  const cats = ['전체', ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))];
  const container = document.getElementById('category-filters');
  container.innerHTML = cats
    .map((c) => {
      const isActive = (c === '전체' && !state.activeCategory) || c === state.activeCategory;
      const cnt = c === '전체' ? folder.place_count : counts.get(c);
      return `<button class="chip ${isActive ? 'active' : ''}" data-cat="${c}">${c} ${cnt}</button>`;
    })
    .join('');
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.activeCategory = chip.dataset.cat === '전체' ? null : chip.dataset.cat;
      renderCategories();
      applyFilters();
    });
  });
  document.getElementById('new-count').textContent = folder.new_count;
}

function formatScore(s) {
  if (typeof s === 'number' && s > 0) return `★ ${s.toFixed(2)}`;
  return '';
}
function formatReviews(n) {
  if (!n) return '';
  return n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);
}
function formatRelativeAdded(d) {
  if (!d) return '';
  const today = new Date();
  const dt = new Date(d + 'T00:00:00');
  const days = Math.floor((today - dt) / 86400000);
  if (days < 1) return '오늘';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  return d;
}

function renderPlacesList() {
  const list = document.getElementById('places-list');
  const badge = document.getElementById('count-badge');
  const total = getActiveFolder().place_count;
  badge.textContent = state.filtered.length < total ? `(${state.filtered.length}/${total})` : `(${total})`;

  if (!state.filtered.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);">표시할 장소가 없습니다.</div>';
    return;
  }

  list.innerHTML = state.filtered.map((p) => {
    const score = formatScore(p.score);
    const reviews = formatReviews(p.review_count);
    const micro = (p.micro_reviews || [])[0];
    return `
      <div class="place-item ${p.sid === state.selectedSid ? 'active' : ''} ${p.available === false ? 'unavailable' : ''}" data-sid="${p.sid}">
        <div class="place-item-header">
          <span class="place-name">${p.name}${p.is_new ? '<span class="badge-new">NEW</span>' : ''}${p.available === false ? '<span class="badge-closed">폐업</span>' : ''}</span>
          <span class="place-category">${p.category_name || ''}</span>
        </div>
        ${score || reviews ? `<div class="place-meta">
          ${score ? `<span class="place-score">${score}</span>` : ''}
          ${reviews ? `<span>리뷰 ${reviews}</span>` : ''}
        </div>` : ''}
        ${micro ? `<div class="place-micro">${micro}</div>` : ''}
        <div class="place-address">${p.road_address || p.address || ''}</div>
        <div class="place-footer">
          <a href="${p.naver_place_url}" target="_blank" rel="noopener" onclick="event.stopPropagation();">네이버 플레이스 →</a>
          <span class="place-added">${formatRelativeAdded(p.added_at)}</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.place-item').forEach((card) => {
    card.addEventListener('click', () => {
      const p = state.filtered.find((x) => x.sid === card.dataset.sid);
      if (p) selectPlace(p);
    });
  });
}

function selectPlace(p, opts = {}) {
  state.selectedSid = p.sid;
  document.querySelectorAll('.place-item').forEach((el) => el.classList.toggle('active', el.dataset.sid === p.sid));
  const card = document.querySelector(`.place-item[data-sid="${p.sid}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (!opts.skipPan) panToPlace(p);
}

// === Filters / Sort ===
function applyFilters() {
  const folder = getActiveFolder();
  let result = [...folder.places];
  if (state.activeCategory) result = result.filter((p) => (p.category_name || '기타') === state.activeCategory);
  if (state.newOnly) result = result.filter((p) => p.is_new);

  const sortBy = state.sortBy;
  if (sortBy === 'added') {
    result.sort((a, b) => {
      if (a.is_new !== b.is_new) return a.is_new ? -1 : 1;
      return (b.added_at || '').localeCompare(a.added_at || '');
    });
  } else if (sortBy === 'score') {
    result.sort((a, b) => (b.score || 0) - (a.score || 0));
  } else if (sortBy === 'reviews') {
    result.sort((a, b) => (b.review_count || 0) - (a.review_count || 0));
  } else if (sortBy === 'name') {
    result.sort((a, b) => a.name.localeCompare(b.name));
  }

  state.filtered = result;
  renderPlacesList();
  refreshMarkers();
}

// === Geolocation ===
function goToMyLocation() {
  if (!navigator.geolocation || !state.map) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (state.mapProvider === 'naver') {
      state.map.setCenter(new naver.maps.LatLng(lat, lng));
      state.map.setZoom(14);
    } else if (state.mapProvider === 'google') {
      state.map.setCenter({ lat, lng });
      state.map.setZoom(14);
    }
  }, () => fitBounds(), { enableHighAccuracy: true, timeout: 5000 });
}

function bindEvents() {
  document.getElementById('filter-new').addEventListener('change', (e) => {
    state.newOnly = e.target.checked;
    applyFilters();
  });
  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    applyFilters();
  });
  document.getElementById('btn-my-location').addEventListener('click', goToMyLocation);
  document.getElementById('btn-list-toggle').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('sidebar-closed');
    sb.classList.toggle('sidebar-open');
  });
  window.addEventListener('hashchange', () => init(true));
}

async function init(reload = false) {
  if (!reload) await loadConfig();

  state.index = await loadJson('data/collections/index.json');
  if (!state.index.curators.length) {
    document.getElementById('places-list').innerHTML =
      '<div style="padding:24px;text-align:center;">등록된 큐레이터가 없습니다.</div>';
    document.getElementById('loader').classList.add('hidden');
    return;
  }
  const hash = parseHash();
  const slug = hash.slug && state.index.curators.find((c) => c.slug === hash.slug)
    ? hash.slug
    : state.index.curators[0].slug;
  state.curator = await loadJson(`data/collections/${slug}.json`);
  state.activeFolderId =
    hash.folderId && state.curator.folders.find((f) => f.share_id === hash.folderId)
      ? hash.folderId
      : state.curator.folders[0].share_id;
  setHash(slug, state.activeFolderId);

  renderCuratorSelect();
  renderHeader();
  renderFolderTabs();
  renderCategories();

  if (!reload) {
    bindEvents();
    await initMap();
  }

  applyFilters();
  document.getElementById('loader').classList.add('hidden');
}

init();
