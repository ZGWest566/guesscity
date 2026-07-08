// ============================================================
//  app.js – 猜地名游戏 (多题库，10题不重复，计分规则：20km内满分，300km外0分)
//  地图底图：Esri 卫星图 (无标注) 为主，高德/ CartoDB 备选
// ============================================================

// ---------- 地图提供商配置 ----------
const MAP_PROVIDERS = {
    'google-satellite': {
        name: 'Google 影像 (无标注)',
        url: 'https://gac-geo.googlecnapps.cn/maps/vt?lyrs=s&x={x}&y={y}&z={z}',
        attribution: '&copy; Google'
    },
    'esri-satellite': {
        name: 'Esri 卫星影像 (无标注)',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    },
    'amap-satellite': {
        name: '高德卫星影像 (无标注)',
        url: 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
        attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
        subdomains: ['01', '02', '03', '04']
    },
    'cartodb': {
        name: 'CartoDB 矢量 (纯路网图)',
        url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; CartoDB',
        subdomains: 'abcd'
    }
};

// ---------- 工具函数 ----------
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    // 经度差归一化到 [-180, 180]
    let dLng = (lng2 - lng1) % 360;
    if (dLng > 180) dLng -= 360;
    else if (dLng < -180) dLng += 360;

    const dLat = (lat2 - lat1) * Math.PI / 180;
    dLng = dLng * Math.PI / 180;

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function formatDist(km) {
    if (km < 1) return Math.round(km * 1000) + ' m';
    if (km < 10) return km.toFixed(1) + ' km';
    return Math.round(km) + ' km';
}

// 新计分规则：20km内满分100，20~300km线性递减，300km外0分
function calcScore(dist) {
    const maxDist = 300; // km
    const fullScoreDist = 20; // km
    if (dist <= fullScoreDist) return 100;
    if (dist >= maxDist) return 0;
    const score = 100 * (1 - (dist - fullScoreDist) / (maxDist - fullScoreDist));
    return Math.round(score);
}

function getCitiesByName(cities, name) {
    return cities.filter(c => c.name === name);
}

// ---------- DOM 引用 ----------
const $ = (id) => document.getElementById(id);
const dom = {
    totalScore: $('totalScore'),
    roundNum: $('roundNum'),
    totalRounds: $('totalRounds'),
    correctCount: $('correctCount'),
    cityNameDisplay: $('cityNameDisplay'),
    hintText: $('hintText'),
    distDisplay: $('distDisplay'),
    roundScoreBadge: $('roundScoreBadge'),
    targetNameDisplay: $('targetNameDisplay'),
    btnNext: $('btnNext'),
    btnMapView: $('btnMapView'),
    toast: $('toast'),
    quizSelect: $('quizSelect'),
    mapSelect: $('mapSelect'),
    resultModal: $('resultModal'),
    finalScore: $('finalScore'),
    finalCorrect: $('finalCorrect'),
    finalTotal: $('finalTotal'),
    btnRestart: $('btnRestart'),
};

// ---------- Toast ----------
let toastTimer = null;

function showToast(msg, type = 'info', duration = 2500) {
    const el = dom.toast;
    el.textContent = msg;
    el.className = 'toast ' + type;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('show');
    }, duration);
}

// ---------- 游戏状态 ----------
const state = {
    totalScore: 0,
    round: 0,
    maxRounds: 10,
    correctCount: 0,
    targetName: '',
    targetCities: [],
    playerLat: null,
    playerLng: null,
    matchedCity: null,
    answered: false,
    map: null,
    markers: [],
    lines: [],
    circles: [],
    cities: [],
    currentQuizId: null,
    usedCityIds: [],
    tileLayer: null, // 当前底图图层
};

// ---------- 题库管理 ----------
let quizList = [];

const PRESET_QUIZZES = [
    { id: 'china1', name: '中国 I 级', url: 'data/china1.json' },
    { id: 'china2', name: '中国 II 级', url: 'data/china2.json' },
    { id: 'china3', name: '中国 III 级', url: 'data/china3.json' },
    { id: 'europe1', name: '欧洲 I 级', url: 'data/europe1.json' },
    { id: 'europe2', name: '欧洲 II 级', url: 'data/europe2.json' },
    { id: 'europe3', name: '欧洲 III 级', url: 'data/europe3.json' },
    { id: 'africa', name: '非洲城市', url: 'data/africa.json' },
    { id: 'usa1', name: '美国 I 级', url: 'data/usa1.json' },
    { id: 'usa2', name: '美国 II 级', url: 'data/usa2.json' },
    { id: 'russia1', name: '俄罗斯+东欧 I 级', url: 'data/russia1.json' },
    { id: 'russia2', name: '俄罗斯+东欧 II 级', url: 'data/russia2.json' },
    { id: 'seasia1', name: '东南亚/日韩 I 级', url: 'data/seasia1.json' },
    { id: 'seasia2', name: '东南亚/日韩 II 级', url: 'data/seasia2.json' },
    { id: 'world_simple', name: '全世界 (简单)', url: 'data/world_simple.json' },
];

function initQuizList() {
    quizList = PRESET_QUIZZES.map(q => ({ ...q, data: null }));
    renderQuizSelect();
}

function renderQuizSelect() {
    const sel = dom.quizSelect;
    sel.innerHTML = '';
    quizList.forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.name;
        sel.appendChild(opt);
    });
    if (state.currentQuizId && quizList.some(q => q.id === state.currentQuizId)) {
        sel.value = state.currentQuizId;
    } else if (quizList.length > 0) {
        sel.value = quizList[0].id;
        if (!state.currentQuizId || !quizList.some(q => q.id === state.currentQuizId)) {
            state.currentQuizId = sel.value;
        }
    }
}

// ---------- 加载指定题库 ----------
async function loadQuiz(quizId) {
    const quiz = quizList.find(q => q.id === quizId);
    if (!quiz) {
        showToast('❌ 未找到该题库', 'error');
        return;
    }

    let citiesData = quiz.data;
    if (!citiesData && quiz.url) {
        try {
            const response = await fetch(quiz.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            if (json.cities && Array.isArray(json.cities)) {
                citiesData = json.cities;
                if (json.quizName) {
                    quiz.name = json.quizName;
                    renderQuizSelect();
                }
            } else {
                throw new Error('无效的题库格式，缺少 cities 数组');
            }
        } catch (err) {
            showToast(`❌ 加载题库失败: ${err.message}`, 'error', 3000);
            return;
        }
    } else if (!citiesData) {
        showToast('❌ 题库数据为空', 'error');
        return;
    }

    state.cities = citiesData;
    state.currentQuizId = quizId;
    renderQuizSelect();

    resetGameState();
    clearMapOverlays();
    dom.btnNext.disabled = true;
    dom.btnMapView.disabled = true;
    dom.distDisplay.textContent = '—';
    dom.roundScoreBadge.textContent = '—';
    dom.targetNameDisplay.textContent = '';
    state.answered = false;

    newRound();
    showToast(`✅ 已切换到「${quiz.name}」题库，共 ${state.cities.length} 个城市`, 'success', 2000);
}

function resetGameState() {
    state.totalScore = 0;
    state.round = 0;
    state.correctCount = 0;
    state.usedCityIds = [];
    updateStats();
    dom.resultModal.style.display = 'none';
}

// ---------- 地图底图切换 ----------
function switchMapProvider(providerId) {
    const provider = MAP_PROVIDERS[providerId];
    if (!provider) return;

    if (state.tileLayer) {
        state.map.removeLayer(state.tileLayer);
    }

    const layer = L.tileLayer(provider.url, {
        maxZoom: 19,
        attribution: provider.attribution,
        subdomains: provider.subdomains || 'abc',
    });
    layer.addTo(state.map);
    state.tileLayer = layer;
    state.map.invalidateSize();
}

// ---------- 地图覆盖物管理 ----------
function clearMapOverlays() {
    const { map, markers, lines, circles } = state;
    markers.forEach(m => map.removeLayer(m));
    lines.forEach(l => map.removeLayer(l));
    circles.forEach(c => map.removeLayer(c));
    state.markers = [];
    state.lines = [];
    state.circles = [];
}

function addMarker(lat, lng, color = '#ffd966', label = '', popup = '') {
    const { map } = state;
    const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
    });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    if (popup) {
        marker.bindPopup(popup, { closeButton: true });
    }
    state.markers.push(marker);
    return marker;
}

function addLine(lat1, lng1, lat2, lng2, color = 'rgba(255,215,0,0.5)', dash = '5,8') {
    const { map } = state;
    const line = L.polyline([
        [lat1, lng1],
        [lat2, lng2]
    ], {
        color: color,
        weight: 2,
        dashArray: dash,
        opacity: 0.7,
        interactive: false,
    }).addTo(map);
    state.lines.push(line);
    return line;
}

function addCircle(lat, lng, radius, color = 'rgba(255,215,0,0.15)') {
    const { map } = state;
    const circle = L.circle([lat, lng], {
        radius: radius,
        color: 'rgba(255,215,0,0.3)',
        weight: 1,
        fillColor: color,
        fillOpacity: 0.3,
        interactive: false,
    }).addTo(map);
    state.circles.push(circle);
    return circle;
}

function flyTo(lat, lng, zoom = 6) {
    state.map.flyTo([lat, lng], zoom, { duration: 1.2 });
}

// ---------- 地图初始化 ----------
function initMap() {
    const map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        minZoom: 3,
        maxZoom: 18,
        zoomControl: true,
        attributionControl: true,
    });

    state.map = map;
    // 默认使用 Esri 卫星图（无标注）
    switchMapProvider('esri-satellite');
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
    return map;
}

// ---------- 启用/禁用地图点击 ----------
function enableMapClick(enabled) {
    const { map } = state;
    if (enabled) {
        map.on('click', onMapClick);
    } else {
        map.off('click', onMapClick);
    }
}

// ---------- 地图点击处理 ----------
function onMapClick(e) {
    if (state.answered) {
        showToast('⏳ 本题已完成，点击「下一题」继续', 'info', 1500);
        return;
    }

    let { lat, lng } = e.latlng;
    // 归一化经度到 [-180, 180]
    lng = ((lng % 360) + 540) % 360 - 180;

    state.playerLat = lat;
    state.playerLng = lng;

    clearMapOverlays();
    addMarker(lat, lng, '#ff6b6b', '你的选择', '📍 你点击的位置');

    const cities = state.targetCities;
    let nearest = null;
    let minDist = Infinity;
    for (const city of cities) {
        const dist = haversine(lat, lng, city.lat, city.lng);
        if (dist < minDist) {
            minDist = dist;
            nearest = city;
        }
    }
    if (!nearest) {
        showToast('⚠️ 未找到匹配的城市，请重试', 'error', 1500);
        return;
    }
    state.matchedCity = nearest;

    addMarker(nearest.lat, nearest.lng, '#ffd700', nearest.chineseName,
        `<b>${nearest.chineseName}</b> (${nearest.localName})`
    );
    addLine(lat, lng, nearest.lat, nearest.lng, 'rgba(255,215,0,0.6)', '6,10');
    addCircle(nearest.lat, nearest.lng, 20000, 'rgba(76, 175, 80, 0.15)');

    const score = calcScore(minDist);
    const distStr = formatDist(minDist);

    dom.distDisplay.innerHTML = `${distStr} <span class="km">· ${Math.round(minDist)} km</span>`;
    dom.roundScoreBadge.textContent = score + '分';
    dom.roundScoreBadge.style.color = score >= 80 ? '#7dd3fc' : score >= 50 ? '#f6d365' : '#ff8a80';
    dom.targetNameDisplay.innerHTML = `🎯 目标: <strong>${nearest.chineseName}</strong> (${nearest.localName})`;

    state.answered = true;
    state.totalScore += score;
    if (minDist < 300) state.correctCount++;
    updateStats();

    dom.btnNext.disabled = false;
    dom.btnMapView.disabled = false;
    enableMapClick(false);
    flyTo(nearest.lat, nearest.lng, 5);

    let emoji = '🎯';
    if (minDist < 20) emoji = '🏆';
    else if (minDist < 50) emoji = '🌟';
    else if (minDist < 150) emoji = '👍';
    else if (minDist < 300) emoji = '📌';
    else emoji = '🗺️';
    showToast(`${emoji} 距离 ${distStr}，得分 ${score} 分！`, score >= 70 ? 'success' : 'info', 3000);
}

// ---------- 更新统计 ----------
function updateStats() {
    dom.totalScore.textContent = state.totalScore;
    dom.roundNum.textContent = Math.min(state.round, state.maxRounds);
    dom.totalRounds.textContent = state.maxRounds;
    dom.correctCount.textContent = state.correctCount;
}

// ---------- 更新提示 ----------
function updatePrompt() {
    const cities = state.targetCities;
    if (!cities || cities.length === 0) return;
    const first = cities[0];
    const chinese = first.chineseName;
    const local = first.localName;

    dom.cityNameDisplay.innerHTML = `
        <span class="chinese">${chinese}</span>
        <span class="divider">·</span>
        <span class="local">${local}</span>
    `;

    const count = cities.length;
    let hint = '👆 点击地图选择位置';
    if (count > 1) {
        hint = `💡 该地名有 ${count} 个城市，系统将自动选择离你点击最近的一个`;
    }
    dom.hintText.textContent = hint + ' (20km内满分，300km外0分)';
}

// ---------- 显示结算弹窗 ----------
function showResultModal() {
    dom.finalScore.textContent = state.totalScore;
    dom.finalCorrect.textContent = state.correctCount;
    dom.finalTotal.textContent = state.maxRounds;
    dom.resultModal.style.display = 'flex';
    enableMapClick(false);
}

// ---------- 新的一题 ----------
function newRound() {
    if (state.cities.length === 0) {
        showToast('❌ 当前题库为空，请切换题库', 'error');
        return;
    }

    if (state.round >= state.maxRounds) {
        showResultModal();
        return;
    }

    const availableCities = state.cities.filter(c => !state.usedCityIds.includes(c.id));
    if (availableCities.length === 0) {
        state.usedCityIds = [];
        newRound();
        return;
    }

    const seed = randomPick(availableCities);
    const name = seed.name;
    state.targetName = name;
    state.targetCities = getCitiesByName(state.cities, name);
    state.usedCityIds.push(seed.id);

    state.round++;
    state.answered = false;
    state.playerLat = null;
    state.playerLng = null;
    state.matchedCity = null;

    clearMapOverlays();

    updatePrompt();

    dom.distDisplay.textContent = '—';
    dom.roundScoreBadge.textContent = '—';
    dom.targetNameDisplay.textContent = '';
    dom.btnNext.disabled = true;
    dom.btnMapView.disabled = true;

    updateStats();

    enableMapClick(true);

    showToast(`第 ${state.round} 题：找到「${seed.chineseName}」的位置`, 'info', 2000);
}

// ---------- 地图查看 ----------
function openMapView() {
    const city = state.matchedCity;
    if (!city) return;
    const url = `https://www.openstreetmap.org/?mlat=${city.lat}&mlon=${city.lng}&zoom=12`;
    window.open(url, '_blank');
}

// ---------- 重置游戏 ----------
function resetGame() {
    dom.resultModal.style.display = 'none';
    resetGameState();
    clearMapOverlays();
    dom.btnNext.disabled = true;
    dom.btnMapView.disabled = true;
    dom.distDisplay.textContent = '—';
    dom.roundScoreBadge.textContent = '—';
    dom.targetNameDisplay.textContent = '';
    state.answered = false;
    newRound();
    showToast('🔄 新的一局开始！', 'info', 2000);
}

// ---------- 填充地图下拉菜单 ----------
function populateMapSelect() {
    const select = dom.mapSelect;
    select.innerHTML = '';
    for (const [key, provider] of Object.entries(MAP_PROVIDERS)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = provider.name;
        select.appendChild(opt);
    }
    // 默认选中 Esri 卫星图
    select.value = 'esri-satellite';
}

// ---------- 启动游戏 ----------
async function startGame() {
    // 填充地图选择器
    populateMapSelect();

    initQuizList();

    if (quizList.length === 0) {
        showToast('❌ 没有可用的题库，请检查 data/ 目录', 'error', 4000);
        return;
    }

    initMap();

    // 绑定地图切换
    dom.mapSelect.addEventListener('change', (e) => {
        const provider = e.target.value;
        if (provider) {
            switchMapProvider(provider);
            showToast(`切换到 ${MAP_PROVIDERS[provider].name}`, 'info', 1500);
        }
    });

    const first = quizList[0];
    state.currentQuizId = first.id;
    await loadQuiz(first.id);

    dom.quizSelect.addEventListener('change', (e) => {
        const id = e.target.value;
        if (id && id !== state.currentQuizId) {
            loadQuiz(id);
        }
    });

    dom.btnNext.addEventListener('click', () => {
        newRound();
    });

    dom.btnMapView.addEventListener('click', openMapView);
    dom.btnRestart.addEventListener('click', resetGame);

    document.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Space') {
            e.preventDefault();
            if (dom.resultModal.style.display === 'flex') {
                dom.btnRestart.click();
            } else if (!dom.btnNext.disabled) {
                dom.btnNext.click();
            }
        }
    });

    window.addEventListener('resize', () => {
        if (state.map) setTimeout(() => state.map.invalidateSize(), 100);
    });

    showToast('🌍 点击地图，找到地名对应的城市！', 'info', 3000);
}

// ---------- 页面加载后启动 ----------
window.onload = startGame;
