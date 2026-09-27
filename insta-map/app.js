/**
 * Insta Map - 인스타그램 맛집 지도 앱
 *
 * 지도 API 우선순위:
 *   1. Naver Maps (NAVER_MAPS_CLIENT_ID)
 *   2. Google Maps (GOOGLE_MAPS_API_KEY)
 *   3. 폴백 (목록만 표시)
 *
 * 설정: public/config.js 파일에 API 키를 넣으면 자동 로드.
 */

// === State ===
const state = {
  data: null,
  filtered: [],
  activeCategory: null,
  activeReviewers: new Set(), // 빈 set = 전체
  searchQuery: '',
  selectedId: null,
  map: null,
  markers: [],
  infoWindow: null,
  mapProvider: null,
  syncMapToList: true,
  skipBoundsSync: false,
  reviewerColors: {}, // reviewer_id → color
};

// === Config ===
const CONFIG = {
  NAVER_MAPS_CLIENT_ID: '',
  GOOGLE_MAPS_API_KEY: '',
  DEFAULT_CENTER: { lat: 37.5665, lng: 126.978 }, // 서울 시청
  DEFAULT_ZOOM: 12,
};

// config.js에서 키 로드 시도
function loadConfig() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'config.js';
    script.onload = () => {
      if (window.INSTA_MAP_CONFIG) {
        Object.assign(CONFIG, window.INSTA_MAP_CONFIG);
      }
      resolve();
    };
    script.onerror = () => resolve(); // config.js 없어도 진행
    document.head.appendChild(script);
  });
}

// === Data ===
async function loadData() {
  try {
    const resp = await fetch('data/restaurants.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.data = await resp.json();
    state.filtered = [...state.data.restaurants];
    return true;
  } catch (e) {
    console.error('데이터 로드 실패:', e);
    return false;
  }
}

// === Map Initialization ===
function initNaverMap() {
  return new Promise((resolve, reject) => {
    if (!CONFIG.NAVER_MAPS_CLIENT_ID) return reject('키 없음');

    const script = document.getElementById('naver-maps-script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CONFIG.NAVER_MAPS_CLIENT_ID}`;
    script.onload = () => {
      try {
        const map = new naver.maps.Map('map', {
          center: new naver.maps.LatLng(CONFIG.DEFAULT_CENTER.lat, CONFIG.DEFAULT_CENTER.lng),
          zoom: CONFIG.DEFAULT_ZOOM,
          zoomControl: true,
          zoomControlOptions: {
            position: naver.maps.Position.RIGHT_CENTER,
          },
          scaleControl: false,
          // 로고/저작권은 기본(하단) 유지 — 바텀시트가 28px 위에 있어 겹치지 않음
        });
        state.map = map;
        state.mapProvider = 'naver';
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    script.onerror = () => reject('Naver Maps 로드 실패');
  });
}

function initGoogleMap() {
  return new Promise((resolve, reject) => {
    if (!CONFIG.GOOGLE_MAPS_API_KEY) return reject('키 없음');

    const script = document.getElementById('google-maps-script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_API_KEY}&language=ko`;
    script.onload = () => {
      try {
        const map = new google.maps.Map(document.getElementById('map'), {
          center: CONFIG.DEFAULT_CENTER,
          zoom: CONFIG.DEFAULT_ZOOM,
        });
        state.map = map;
        state.mapProvider = 'google';
        state.infoWindow = new google.maps.InfoWindow();
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    script.onerror = () => reject('Google Maps 로드 실패');
  });
}

async function initMap() {
  try {
    await initNaverMap();
    console.log('Naver Maps 초기화 완료');
    return;
  } catch (e) {
    console.log('Naver Maps 사용 불가:', e);
  }

  try {
    await initGoogleMap();
    console.log('Google Maps 초기화 완료');
    return;
  } catch (e) {
    console.log('Google Maps 사용 불가:', e);
  }

  // 폴백
  document.getElementById('map').style.display = 'none';
  document.getElementById('map-fallback').style.display = 'flex';
  state.mapProvider = null;
}

// === Markers ===
function closeAllInfoWindows() {
  if (state.mapProvider === 'naver') {
    state.markers.forEach((m) => {
      if (m._infoWindow && m._infoWindow.getMap()) m._infoWindow.close();
    });
  } else if (state.mapProvider === 'google' && state.infoWindow) {
    state.infoWindow.close();
  }
  state.selectedId = null;
  document.querySelectorAll('.restaurant-card').forEach((c) => c.classList.remove('active'));
}

function clearMarkers() {
  state.markers.forEach((m) => {
    if (state.mapProvider === 'naver') m.setMap(null);
    else if (state.mapProvider === 'google') m.setMap(null);
  });
  state.markers = [];
}

function getCategoryColor(cat) {
  const colors = {
    '돈까스': '#ff6f00', '한식': '#e65100', '일식': '#2e7d32',
    '중식': '#c62828', '양식': '#1565c0', '카페': '#7b1fa2', '기타': '#757575',
  };
  return colors[cat] || colors['기타'];
}

function getMarkerColor(r) {
  // 복수 리뷰어 → 금색
  if (r.reviewer_count > 1) return '#ffc107';
  // 단일 리뷰어 → 리뷰어 색상
  if (r.reviewer_ids && r.reviewer_ids.length === 1) {
    return state.reviewerColors[r.reviewer_ids[0]] || getCategoryColor(r.category);
  }
  return getCategoryColor(r.category);
}

function getMarkerSize(r) {
  return r.reviewer_count > 1 ? 16 : 12;
}

function renderRating(rating) {
  if (!rating) return '';
  return '<span style="color:#ff9800;letter-spacing:-2px;">' + '★'.repeat(rating) + '<span style="color:#ddd;">' + '★'.repeat(5 - rating) + '</span></span>';
}

function isMobile() {
  return window.innerWidth <= 768;
}

function createInfoContent(r) {
  const sponsored = r.sponsored ? '<span class="badge-sponsored">AD</span>' : '';
  const multiReviewer = r.reviewer_count > 1 ? `<span class="badge-reviewers">${r.reviewer_count}명 추천</span>` : '';
  const rating = r.rating ? `<div style="margin-bottom:3px;">${renderRating(r.rating)}</div>` : '';
  const phone = r.phone ? `<a href="tel:${r.phone}" style="font-size:11px;color:#666;text-decoration:none;">${r.phone}</a>` : '';
  const mobile = isMobile();

  // 리뷰어별 리뷰 — 모바일에선 1개만, 데스크탑은 전부
  const reviewsToShow = mobile ? (r.reviews || []).slice(0, 1) : (r.reviews || []);
  const reviewsHtml = reviewsToShow.map((rv) => `
    <div style="padding:3px 0;border-top:1px solid #f0f0f0;">
      <div style="font-size:11px;font-weight:600;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${rv.reviewer_color};margin-right:3px;"></span>
        ${rv.reviewer_name}
        ${rv.rating ? ' ' + renderRating(rv.rating) : ''}
      </div>
      <div style="font-size:${mobile ? 11 : 12}px;color:#555;margin-top:1px;">${rv.review ? rv.review.slice(0, mobile ? 40 : 80) : ''}</div>
      <a href="${rv.instagram_url}" target="_blank" style="font-size:11px;color:#e1306c;text-decoration:none;">Instagram</a>
    </div>
  `).join('');
  const moreReviewers = mobile && (r.reviews || []).length > 1
    ? `<div style="font-size:11px;color:#999;padding:2px 0;">+${r.reviews.length - 1}명 리뷰 더보기</div>` : '';

  const maxW = mobile ? 220 : 300;
  const maxH = mobile ? 200 : 350;

  return `
    <div style="max-width:${maxW}px;font-family:-apple-system,sans-serif;padding:4px;max-height:${maxH}px;overflow-y:auto;">
      <div style="font-size:${mobile ? 13 : 15}px;font-weight:700;margin-bottom:3px;">${r.name}${multiReviewer}${sponsored}</div>
      ${rating}
      <div style="font-size:11px;color:#666;margin-bottom:4px;">${r.category} · ${(r.road_address || r.address).slice(0, mobile ? 25 : 100)}</div>
      ${reviewsHtml}
      ${moreReviewers}
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;padding-top:3px;border-top:1px solid #eee;">
        ${phone ? phone + ' · ' : ''}
        <a href="${r.naver_map_url}" target="_blank" style="font-size:11px;color:#1ec800;text-decoration:none;">네이버지도</a>
      </div>
    </div>
  `;
}

function addNaverMarkers() {
  state.filtered.forEach((r) => {
    if (!r.lat || !r.lng) return;

    const sz = getMarkerSize(r);
    const color = getMarkerColor(r);
    const border = r.reviewer_count > 1 ? '3px solid #fff' : '2px solid #fff';
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(r.lat, r.lng),
      map: state.map,
      title: r.name,
      icon: {
        content: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:${border};box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        anchor: new naver.maps.Point(sz / 2, sz / 2),
      },
    });

    const infoWindow = new naver.maps.InfoWindow({
      content: createInfoContent(r),
      borderWidth: 0,
      borderColor: 'transparent',
      backgroundColor: '#fff',
      anchorSize: new naver.maps.Size(10, 10),
      pixelOffset: new naver.maps.Point(0, -4),
    });

    naver.maps.Event.addListener(marker, 'click', () => {
      state.markers.forEach((m) => {
        if (m._infoWindow && m._infoWindow.getMap()) m._infoWindow.close();
      });
      infoWindow.open(state.map, marker);
      selectRestaurant(r, { skipPan: true });
    });

    marker._infoWindow = infoWindow;
    marker._data = r;
    state.markers.push(marker);
  });
}

function addGoogleMarkers() {
  state.filtered.forEach((r) => {
    if (!r.lat || !r.lng) return;

    const marker = new google.maps.Marker({
      position: { lat: r.lat, lng: r.lng },
      map: state.map,
      title: r.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: getMarkerColor(r),
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: r.reviewer_count > 1 ? 3 : 2,
        scale: r.reviewer_count > 1 ? 9 : 7,
      },
    });

    marker.addListener('click', () => {
      state.infoWindow.setContent(createInfoContent(r));
      state.infoWindow.open(state.map, marker);
      selectRestaurant(r, { skipPan: true });
    });

    marker._data = r;
    state.markers.push(marker);
  });
}

// === 현위치 ===
function goToMyLocation() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const zoom = 14;

      state.userLat = lat;
      state.userLng = lng;
      // 카드 거리 표시 갱신
      if (state.data) renderRestaurantList();

      if (state.mapProvider === 'naver') {
        state.map.setCenter(new naver.maps.LatLng(lat, lng));
        state.map.setZoom(zoom);
      } else if (state.mapProvider === 'google') {
        state.map.setCenter({ lat, lng });
        state.map.setZoom(zoom);
      }
    },
    () => {
      // 위치 거부 시 전체 fitBounds
      fitBounds();
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

function addAllMarkers() {
  clearMarkers();
  if (state.mapProvider === 'naver') addNaverMarkers();
  else if (state.mapProvider === 'google') addGoogleMarkers();
}

function updateMarkers() {
  addAllMarkers();
  state.skipBoundsSync = true;
  fitBounds();
  setTimeout(() => { state.skipBoundsSync = false; }, 500);
}

function getVisibleRestaurants() {
  if (!state.map || !state.mapProvider) return state.filtered;

  let bounds;
  if (state.mapProvider === 'naver') {
    bounds = state.map.getBounds();
    return state.filtered.filter((r) => {
      if (!r.lat || !r.lng) return false;
      return bounds.hasPoint(new naver.maps.LatLng(r.lat, r.lng));
    });
  } else if (state.mapProvider === 'google') {
    bounds = state.map.getBounds();
    if (!bounds) return state.filtered;
    return state.filtered.filter((r) => {
      if (!r.lat || !r.lng) return false;
      return bounds.contains({ lat: r.lat, lng: r.lng });
    });
  }
  return state.filtered;
}

function syncListToMap() {
  if (!state.syncMapToList || state.skipBoundsSync) return;
  const visible = getVisibleRestaurants();
  renderRestaurantList(visible);
}

function fitBounds() {
  const points = state.filtered.filter((r) => r.lat && r.lng);
  if (!points.length) return;

  if (state.mapProvider === 'naver') {
    const bounds = new naver.maps.LatLngBounds(
      new naver.maps.LatLng(
        Math.min(...points.map((p) => p.lat)),
        Math.min(...points.map((p) => p.lng))
      ),
      new naver.maps.LatLng(
        Math.max(...points.map((p) => p.lat)),
        Math.max(...points.map((p) => p.lng))
      )
    );
    state.map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
  } else if (state.mapProvider === 'google') {
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    state.map.fitBounds(bounds, 50);
  }
}

function panToRestaurant(r) {
  if (!r.lat || !r.lng || !state.map) return;
  closeAllInfoWindows();

  if (state.mapProvider === 'naver') {
    state.map.setZoom(16);
    state.map.panTo(new naver.maps.LatLng(r.lat, r.lng));
    // 해당 마커의 인포윈도우 열기
    state.markers.forEach((m) => {
      if (m._infoWindow && m._infoWindow.getMap()) m._infoWindow.close();
      if (m._data && m._data.id === r.id && m._infoWindow) {
        m._infoWindow.open(state.map, m);
      }
    });
  } else if (state.mapProvider === 'google') {
    state.map.panTo({ lat: r.lat, lng: r.lng });
    state.map.setZoom(15);
    const marker = state.markers.find((m) => m._data && m._data.id === r.id);
    if (marker) {
      state.infoWindow.setContent(createInfoContent(r));
      state.infoWindow.open(state.map, marker);
    }
  }
}

// === UI Rendering ===
function renderReviewers() {
  const reviewers = (state.data.meta && state.data.meta.reviewers) || [];
  if (reviewers.length < 2) {
    document.getElementById('reviewer-filters').parentElement.style.display = 'none';
    return;
  }

  // 리뷰어 색상 맵 구성
  reviewers.forEach((rv) => { state.reviewerColors[rv.id] = rv.color; });

  const container = document.getElementById('reviewer-filters');
  const allActive = state.activeReviewers.size === 0;

  container.innerHTML = `<button class="reviewer-chip ${allActive ? 'active' : ''}" data-reviewer="all" style="--chip-color:#333"><span class="dot" style="background:#333"></span>전체</button>` +
    reviewers.map((rv) => {
      const active = state.activeReviewers.has(rv.id);
      // 리뷰어별 음식점 수
      const count = state.data.restaurants.filter((r) => r.reviewer_ids && r.reviewer_ids.includes(rv.id)).length;
      return `<button class="reviewer-chip ${active ? 'active' : ''}" data-reviewer="${rv.id}" style="--chip-color:${rv.color}">
        <span class="dot" style="background:${rv.color}"></span>${rv.display_name} (${count})
      </button>`;
    }).join('');

  container.querySelectorAll('.reviewer-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.reviewer;
      if (id === 'all') {
        state.activeReviewers.clear();
      } else {
        if (state.activeReviewers.has(id)) {
          state.activeReviewers.delete(id);
        } else {
          state.activeReviewers.add(id);
        }
      }
      // 칩 상태 갱신
      const allNow = state.activeReviewers.size === 0;
      container.querySelectorAll('.reviewer-chip').forEach((c) => {
        if (c.dataset.reviewer === 'all') c.classList.toggle('active', allNow);
        else c.classList.toggle('active', state.activeReviewers.has(c.dataset.reviewer));
      });
      applyFilters();
    });
  });
}

function renderCategories() {
  const container = document.getElementById('category-filters');
  const categories = ['전체', ...new Set(state.data.restaurants.map((r) => r.category))];

  container.innerHTML = categories
    .map(
      (cat) =>
        `<button class="chip ${cat === '전체' && !state.activeCategory ? 'active' : ''}" data-cat="${cat}">${cat}</button>`
    )
    .join('');

  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      state.activeCategory = cat === '전체' ? null : cat;
      applyFilters();
      // 칩 활성화 상태 업데이트
      container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function renderRestaurantList(items) {
  const list = items || state.filtered;
  const container = document.getElementById('restaurant-list');
  const countBadge = document.getElementById('count-badge');
  const total = state.filtered.length;
  countBadge.textContent = list.length < total ? `(${list.length}/${total})` : `(${total})`;

  if (!list.length) {
    if (state.searchQuery) {
      container.innerHTML = `<div style="padding:24px;text-align:center;color:#8e8e8e;">'<b>${state.searchQuery}</b>' 검색 결과 없음.<br><button id="btn-clear-search" class="btn-clear-search">검색 비우기</button></div>`;
      const btn = document.getElementById('btn-clear-search');
      if (btn) btn.addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        state.searchQuery = '';
        applyFilters();
      });
    } else {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#8e8e8e;">이 영역에 음식점이 없습니다.<br>지도를 축소해 보세요.</div>';
    }
    return;
  }

  container.innerHTML = list
    .map(
      (r) => {
        const multiReviewer = r.reviewer_count > 1 ? `<span class="badge-reviewers">${r.reviewer_count}명 추천</span>` : '';
        const reviewerDots = (r.reviews || []).map((rv) =>
          `<span class="reviewer-tag"><span class="dot" style="background:${rv.reviewer_color}"></span>${rv.reviewer_name}</span>`
        ).join(' ');
        const latestReview = (r.reviews && r.reviews[0]) ? r.reviews[0] : {};
        const curation = latestReview.curation;
        const curationBadge = curation && curation.total > 1
          ? `<span class="badge-curation" title="이 게시글에서 ${curation.total}곳 추천 중 ${curation.sub_id}번째">큐레이션 ${curation.sub_id}/${curation.total}</span>`
          : '';
        const distBadge = (state.userLat && r.lat) ? `<span class="badge-distance">${formatDistance(haversine(state.userLat, state.userLng, r.lat, r.lng))}</span>` : '';
        // 1년 이상 지난 리뷰면 "오래됨" 뱃지
        const ageBadge = (() => {
          if (!r.posted_at) return '';
          const t = Date.parse(r.posted_at);
          if (isNaN(t)) return '';
          const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
          if (days > 365) return `<span class="badge-stale" title="${r.posted_at}">오래된 리뷰</span>`;
          return '';
        })();
        return `
    <div class="restaurant-card ${r.id === state.selectedId ? 'active' : ''} ${(state.visited && state.visited.has(r.id)) ? 'visited' : ''}" data-id="${r.id}">
      <div class="card-header">
        <span class="card-name">${r.name}${multiReviewer}${curationBadge}${ageBadge}${r.sponsored ? '<span class="badge-sponsored">AD</span>' : ''}</span>
        <span class="card-category" data-cat="${r.category}">${r.category}${distBadge}</span>
      </div>
      <div style="margin:2px 0;">${reviewerDots}</div>
      ${r.rating ? `<div class="card-rating">${renderRating(r.rating)}</div>` : ''}
      <div class="card-review">${latestReview.review || r.review || ''}</div>
      <div class="card-address">${r.road_address || r.address}</div>
      <div class="card-footer">
        <a class="card-link" href="${latestReview.instagram_url || r.instagram_url}" target="_blank" onclick="event.stopPropagation();">Instagram</a>
        <a class="card-link" href="${r.naver_map_url}" target="_blank" onclick="event.stopPropagation();" style="color:#1ec800;">네이버 지도</a>
        ${r.phone ? `<a class="card-link" href="tel:${r.phone}" onclick="event.stopPropagation();" style="color:#333;">${r.phone}</a>` : ''}
        <button class="card-link card-share" data-id="${r.id}" onclick="event.stopPropagation();" style="background:none;border:none;cursor:pointer;color:#666;padding:0;">공유</button>
        <span class="card-date">${r.posted_at}</span>
      </div>
    </div>`;
      }
    )
    .join('');

  container.querySelectorAll('.card-share').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const url = `${window.location.origin}${window.location.pathname}#r=${id}`;
      const r = state.data.restaurants.find((x) => x.id === id);
      const title = r ? r.name : 'Insta Map';
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
        } else {
          await navigator.clipboard.writeText(url);
          btn.textContent = '복사됨';
          setTimeout(() => { btn.textContent = '공유'; }, 1500);
        }
      } catch {}
    });
  });

  container.querySelectorAll('.restaurant-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const r = state.data.restaurants.find((x) => x.id === id);
      if (r) {
        selectRestaurant(r, { updateHash: true });
        // 모바일: 바텀시트 접기
        if (isMobile()) {
          const sidebar = document.getElementById('sidebar');
          sidebar.classList.add('sidebar-closed');
          sidebar.classList.remove('sidebar-open');
          syncSheetDependentUI();
        }
      }
    });
  });
}

// 한글 초성 추출 (까치네분식 → ㄲㅊㄴㅂㅅ)
const CHOSUNG_LIST = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
function toChosung(s) {
  if (!s) return '';
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      out += CHOSUNG_LIST[Math.floor((code - 0xAC00) / 588)];
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}
function isChosung(s) {
  return /^[ㄱ-ㅎ]+$/.test(s);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

const VISITED_KEY = 'insta-map.visited';
function loadVisited() {
  try { return new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveVisited(set) {
  try { localStorage.setItem(VISITED_KEY, JSON.stringify([...set])); } catch {}
}

// 모바일 바텀시트 상태에 종속된 UI(맵 컨테이너 높이, FAB 위치) 동기화.
// 시트가 접히면 지도가 화면 거의 전체로 확장되고 FAB도 시트 핸들 위로 내려간다.
function syncSheetDependentUI() {
  if (!isMobile()) return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.contains('sidebar-closed');
  const fab = document.getElementById('btn-my-location');
  const mapContainer = document.getElementById('map-container');
  if (fab) fab.classList.toggle('sheet-collapsed', collapsed);
  if (mapContainer) mapContainer.classList.toggle('sheet-collapsed', collapsed);
  // 지도 SDK 에 리사이즈 통지 (transition 끝난 뒤)
  setTimeout(() => {
    if (state.mapProvider === 'naver' && state.map && state.map.autoResize) state.map.autoResize();
    else if (state.mapProvider === 'google' && state.map && window.google) google.maps.event.trigger(state.map, 'resize');
  }, 350);
}

function bindBottomSheetDrag() {
  const sidebar = document.getElementById('sidebar');
  const header = document.getElementById('sidebar-header');
  if (!sidebar || !header) return;

  let startY = 0;
  let dragging = false;
  let moved = false;

  const onStart = (e) => {
    if (window.innerWidth > 768) return;
    if (e.target.closest('select')) return;
    startY = e.touches[0].clientY;
    dragging = true;
    moved = false;
    sidebar.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    moved = Math.abs(dy) > 5;
    if (!moved) return;
    state._dragMoved = true;
    // 닫혀 있을 때 위로 끌면 dy < 0 → 점진 노출. 열려 있을 때 아래로 끌면 dy > 0 → 점진 닫힘.
    const closed = sidebar.classList.contains('sidebar-closed');
    let translate;
    if (closed) {
      // 닫힌 상태(translateY(100% - 56px))에서 dy < 0 만큼 위로
      translate = `translateY(calc(100% - 56px + ${Math.min(0, dy)}px))`;
    } else {
      translate = `translateY(${Math.max(0, dy)}px)`;
    }
    sidebar.style.transform = translate;
  };
  const onEnd = (e) => {
    if (!dragging) return;
    dragging = false;
    sidebar.style.transition = '';
    sidebar.style.transform = '';
    if (!moved) return;
    const dy = (e.changedTouches[0].clientY - startY);
    const closed = sidebar.classList.contains('sidebar-closed');
    if (closed && dy < -40) {
      sidebar.classList.add('sidebar-open');
      sidebar.classList.remove('sidebar-closed');
    } else if (!closed && dy > 60) {
      sidebar.classList.add('sidebar-closed');
      sidebar.classList.remove('sidebar-open');
    }
    syncSheetDependentUI();
  };

  header.addEventListener('touchstart', onStart, { passive: true });
  header.addEventListener('touchmove', onMove, { passive: true });
  header.addEventListener('touchend', onEnd, { passive: true });
}

function selectRestaurant(r, opts = {}) {
  state.selectedId = r.id;
  if (!opts.skipPan) panToRestaurant(r);
  highlightCard(r.id);
  // 방문 기록
  if (!state.visited) state.visited = loadVisited();
  if (!state.visited.has(r.id)) {
    state.visited.add(r.id);
    saveVisited(state.visited);
    // 카드에 visited 클래스 즉시 부여
    const card = document.querySelector(`.restaurant-card[data-id="${r.id}"]`);
    if (card) card.classList.add('visited');
  }
  if (opts.updateHash !== false) {
    const newHash = `#r=${r.id}`;
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }
}

function selectFromHash() {
  const m = window.location.hash.match(/^#r=([\w-]+)/);
  if (!m) return;
  const r = state.data.restaurants.find((x) => x.id === m[1]);
  if (r) selectRestaurant(r, { updateHash: false });
}

function highlightCard(id) {
  document.querySelectorAll('.restaurant-card').forEach((c) => c.classList.remove('active'));
  const card = document.querySelector(`.restaurant-card[data-id="${id}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderUnresolved() {
  if (!state.data.unresolved || !state.data.unresolved.length) return;

  const section = document.getElementById('unresolved-section');
  section.style.display = 'block';
  document.getElementById('unresolved-badge').textContent = `(${state.data.unresolved.length})`;

  const container = document.getElementById('unresolved-list');
  container.innerHTML = state.data.unresolved
    .map(
      (u) => `
    <div class="unresolved-card">
      <div class="card-name">${u.name_hint || '이름 미상'} ${u.area_hint ? `(${u.area_hint})` : ''}</div>
      <div class="card-reason">${u.reason}</div>
      ${
        u.candidates && u.candidates.length
          ? `<div class="candidate-list">후보: ${u.candidates.map((c) => c.name).join(', ')}</div>`
          : ''
      }
      ${u.instagram_url ? `<a class="card-link" href="${u.instagram_url}" target="_blank" style="font-size:11px;">Instagram에서 확인</a>` : ''}
    </div>
  `
    )
    .join('');
}

function renderMeta() {
  const meta = state.data.meta;
  const reviewerCount = meta.total_reviewers || 1;
  const names = (meta.reviewers || []).map((r) => `@${r.id}`).join(', ');
  const updated = meta.last_updated ? meta.last_updated.slice(0, 10) : '';
  const updatedPart = updated ? ` · 업데이트 ${updated}` : '';
  document.getElementById('meta-info').textContent =
    `${names || 'unknown'} · ${meta.total_restaurants}개 맛집 · 리뷰어 ${reviewerCount}명${updatedPart}`;
}

// === Filters & Sort ===
function applyFilters() {
  let result = [...state.data.restaurants];

  // 리뷰어 필터
  if (state.activeReviewers.size > 0) {
    result = result.filter((r) =>
      r.reviewer_ids && r.reviewer_ids.some((id) => state.activeReviewers.has(id))
    );
  }

  // 카테고리 필터
  if (state.activeCategory) {
    result = result.filter((r) => r.category === state.activeCategory);
  }

  // 검색 필터 (다중 토큰 AND, 한글 초성 매칭 포함)
  if (state.searchQuery) {
    const tokens = state.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    result = result.filter((r) => {
      const haystack = [r.name, r.address, r.road_address, r.review, r.category].filter(Boolean).join(' ').toLowerCase();
      const choHaystack = toChosung(r.name);
      return tokens.every((t) => haystack.includes(t) || (isChosung(t) && choHaystack.includes(t)));
    });
  }

  // 정렬
  const sortBy = document.getElementById('sort-select').value;
  if (sortBy === 'recommend') result.sort((a, b) => b.reviewer_count - a.reviewer_count || (b.rating || 0) - (a.rating || 0));
  else if (sortBy === 'date') result.sort((a, b) => (b.posted_at || '').localeCompare(a.posted_at || ''));
  else if (sortBy === 'distance') {
    if (state.userLat) {
      result.sort((a, b) => haversine(state.userLat, state.userLng, a.lat, a.lng) - haversine(state.userLat, state.userLng, b.lat, b.lng));
    }
  }
  else if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === 'category') result.sort((a, b) => a.category.localeCompare(b.category));

  state.filtered = result;
  renderRestaurantList();
  addAllMarkers(); // 마커만 갱신, 뷰는 유지
}

// === Events ===
function bindEvents() {
  // 검색 (180ms 디바운스 — 큰 데이터에서 매 키 입력마다 filter/render 부담 회피)
  let searchTimer = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    const v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = v;
      applyFilters();
    }, 180);
  });

  // 정렬
  document.getElementById('sort-select').addEventListener('change', () => {
    applyFilters();
  });

  // 지도 연동 토글
  document.getElementById('btn-sync-toggle').addEventListener('click', () => {
    state.syncMapToList = !state.syncMapToList;
    document.getElementById('btn-sync-toggle').classList.toggle('active', state.syncMapToList);
    if (state.syncMapToList) {
      syncListToMap();
    } else {
      renderRestaurantList(); // 전체 목록 복원
    }
  });

  // 사이드바 토글
  const toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('sidebar-closed');
    sidebar.classList.toggle('sidebar-open');
    syncSheetDependentUI();
  };

  document.getElementById('btn-list-toggle').addEventListener('click', toggleSidebar);

  // 맛집 추천 (mailto)
  const recommendBtn = document.getElementById('btn-recommend');
  if (recommendBtn) {
    const updated = (state.data?.meta?.last_updated || '').slice(0, 10);
    const subject = encodeURIComponent('[Insta Map] 맛집 추천');
    const body = encodeURIComponent(
      [
        '추천하실 맛집 정보를 적어주세요.',
        '',
        '- 가게 이름:',
        '- 위치(주소 또는 지역):',
        '- 인스타 게시글 URL(있다면):',
        '- 한 줄 소감:',
        '',
        '---',
        `현재 데이터 업데이트: ${updated || 'unknown'}`,
      ].join('\n')
    );
    recommendBtn.setAttribute(
      'href',
      `mailto:youngiggy@gmail.com?subject=${subject}&body=${body}`
    );
  }

  // 현위치 버튼
  document.getElementById('btn-my-location').addEventListener('click', () => goToMyLocation());

  // 모바일: 사이드바 헤더 탭으로 바텀시트 토글
  document.getElementById('sidebar-header').addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !e.target.closest('select') && !state._dragMoved) {
      toggleSidebar();
    }
    state._dragMoved = false;
  });

  // 모바일: 바텀시트 드래그 제스처
  bindBottomSheetDrag();
}

// === Init ===
async function init() {
  state.visited = loadVisited();
  await loadConfig();
  const dataLoaded = await loadData();

  if (!dataLoaded) {
    document.getElementById('map-fallback').style.display = 'flex';
    document.getElementById('map-fallback').innerHTML =
      '<p>데이터를 불러올 수 없습니다.</p><p>먼저 데이터를 수집하세요.</p>';
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
    return;
  }

  renderMeta();
  renderReviewers();
  renderCategories();
  renderRestaurantList();
  renderUnresolved();
  bindEvents();

  await initMap();
  addAllMarkers();

  // 데이터 + 지도 준비 완료 → 로더 숨김
  const loader = document.getElementById('loader');
  if (loader) loader.classList.add('hidden');

  // URL hash (#r=<id>) 가 있으면 현위치 대신 해당 음식점 우선
  const hashed = window.location.hash.match(/^#r=([\w-]+)/);
  if (hashed) {
    state.syncMapToList = false;
    selectFromHash();
    setTimeout(() => {
      state.syncMapToList = true;
      bindMapEvents();
      syncListToMap();
    }, 1500);
  } else {
    // 페이지 로드 시 현위치로 시작, 안착 후 지도 연동 활성화
    state.syncMapToList = false;
    goToMyLocation();
    setTimeout(() => {
      state.syncMapToList = true;
      bindMapEvents();
      syncListToMap();
    }, 2000);
  }

  window.addEventListener("hashchange", selectFromHash);

  // ESC 단축키: 검색이 활성이면 비우고, 아니면 모바일 sidebar 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const input = document.getElementById("search-input");
    if (document.activeElement === input || input.value) {
      input.value = "";
      state.searchQuery = "";
      applyFilters();
      input.blur();
    } else if (isMobile()) {
      const sidebar = document.getElementById("sidebar");
      sidebar.classList.add("sidebar-closed");
      sidebar.classList.remove("sidebar-open");
      syncSheetDependentUI();
    }
  });
}

function bindMapEvents() {
  if (!state.map) return;

  if (state.mapProvider === 'naver') {
    naver.maps.Event.addListener(state.map, 'idle', () => syncListToMap());
    naver.maps.Event.addListener(state.map, 'click', () => closeAllInfoWindows());
  } else if (state.mapProvider === 'google') {
    state.map.addListener('idle', () => syncListToMap());
    state.map.addListener('click', () => closeAllInfoWindows());
  }
}

init();
