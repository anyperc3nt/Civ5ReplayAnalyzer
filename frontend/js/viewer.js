// ============================================================================
// viewer.js - Civilization 5 Web Replay Viewer
// ============================================================================

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let app, mapContainer;
let currentIconMode = 'default'; // 'default', 'military', 'civilian', 'resource', 'misc'

// Кэш состояний карты: Map<TurnIndex, TileStateArray>
let mapStateCache = new Map();
const CACHE_INTERVAL = 15; // Сохраняем состояние каждые 25 ходов

// Слои (Z-index определяется порядком добавления)
let baseTerrainLayer, territoryLayer, gridLayer, featuresLayer, hillsLayer; 
let citiesLayer;
let highlightLayer;
let iconLayerRes, iconLayerCiv, iconLayerImprovements, iconLayerMilitary; // Слои иконок
let yieldsLayer;

let staticMapData = null;
let turnsData = null;
let globalReplayData = null; 
const textureCache = {};

// Константы размеров
const HEX_RADIUS = 32; // Увеличили для детализации
const HEX_WIDTH = HEX_RADIUS * Math.sqrt(3);
const HEX_HEIGHT = HEX_RADIUS * 2;

// Список мирных юнитов (все остальные считаются военными)
const CIVILIAN_UNITS = [
    "UNIT_SETTLER", "UNIT_WORKER", "UNIT_MISSIONARY", "UNIT_INQUISITOR", 
    "UNIT_PROPHET", "UNIT_GREAT_GENERAL", "UNIT_GREAT_ADMIRAL", 
    "UNIT_GREAT_ARTIST", "UNIT_GREAT_WRITER", "UNIT_GREAT_MUSICIAN", 
    "UNIT_GREAT_SCIENTIST", "UNIT_GREAT_MERCHANT", "UNIT_GREAT_ENGINEER",
    "UNIT_CARAVAN", "UNIT_CARGO_SHIP"
];

// === ФИЛЬТР ДЛЯ ЮНИТОВ ===
// Превращает красно-зеленые иконки в черно-белые.
// Логика: R=G, G=G, B=G. 
// Если пиксель Зеленый (0,1,0), он станет Белым (1,1,1).
// Если пиксель Красный (1,0,0), в нем G=0, значит он станет Черным (0,0,0).
const unitColorFilter = new PIXI.ColorMatrixFilter();
unitColorFilter.matrix = [
    0, 1, 0, 0, 0, // Red   = 0*R + 1*G + 0*B
    0, 1, 0, 0, 0, // Green = 0*R + 1*G + 0*B
    0, 1, 0, 0, 0, // Blue  = 0*R + 1*G + 0*B
    0, 0, 0, 1, 0  // Alpha = Alpha (без изменений)
];

// Новая функция для получения состояния
function getMapStateAtTurn(targetTurnIndex) {
    // 1. Определяем ближайшую точку старта (0 или кэшированный ход)
    // Ищем ближайший множитель CACHE_INTERVAL, который меньше или равен targetTurnIndex
    let startTurnIndex = 0;
    let currentState = {};

    // Пытаемся найти сохраненный стейт
    // Идем назад с шагом интервала, пока не найдем кэш или не дойдем до 0
    let checkIndex = Math.floor(targetTurnIndex / CACHE_INTERVAL) * CACHE_INTERVAL;
    
    while (checkIndex >= 0) {
        if (mapStateCache.has(checkIndex)) {
            startTurnIndex = checkIndex;
            // ГЛУБОКАЯ КОПИЯ, чтобы не испортить кэш последующими изменениями
            currentState = JSON.parse(JSON.stringify(mapStateCache.get(checkIndex)));
            break;
        }
        checkIndex -= CACHE_INTERVAL;
    }

    // Если кэша нет (или старт с 0), инициализируем из статики (Header)
    if (Object.keys(currentState).length === 0) {
        staticMapData.tiles.forEach((t, idx) => {
            currentState[idx] = { f: t.f, i: t.i || -1, r: t.r };
        });
    }

    // 2. Накатываем изменения от startTurnIndex до targetTurnIndex
    for (let i = startTurnIndex; i <= targetTurnIndex; i++) {
        const tData = turnsData[i];
        
        // Применяем изменения
        if (tData && tData.mapChanges) {
            tData.mapChanges.forEach(change => {
                const s = currentState[change.id];
                if (s) {
                    if (change.f !== undefined) s.f = change.f;
                    if (change.i !== undefined) s.i = change.i;
                    if (change.r !== undefined) s.r = change.r;
                    if (change.y !== undefined) s.y = change.y;
                }
            });
        }

        // 3. Попутно сохраняем в кэш, если попали на кратную точку и её еще нет
        if (i > 0 && i % CACHE_INTERVAL === 0 && !mapStateCache.has(i)) {
            mapStateCache.set(i, JSON.parse(JSON.stringify(currentState)));
            console.log(`[Cache] Created map state snapshot for turn index ${i}`);
        }
    }

    return currentState;
}

// Функция подсветки обработки тайлов
// Обновленная функция подсветки с поддержкой Locked (Замочков)
window.highlightWorkedPlots = function(workedIndices, lockedIndices, colorInt) {
    highlightLayer.removeChildren();
    
    if (!workedIndices || workedIndices.length === 0) return;

    // 1. Рисуем подложку (хайлайт тайлов)
    const g = new PIXI.Graphics();
    g.beginFill(colorInt, 0.45); // Чуть ярче
    g.lineStyle(2, 0xffffff, 0.7);

    // Создаем Set для быстрого поиска залоченных
    const lockedSet = new Set(lockedIndices || []);

    workedIndices.forEach(idx => {
        const q = idx % staticMapData.width;
        const r = Math.floor(idx / staticMapData.width);
        const pos = getHexPosition(q, r);

        // Рисуем гекс
        const path = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i + 30);
            path.push(pos.x + HEX_RADIUS * Math.cos(angle)); 
            path.push(pos.y + HEX_RADIUS * Math.sin(angle));
        }
        g.drawPolygon(path);

        // 2. Если тайл в списке locked -> Рисуем иконку замка поверх
        if (lockedSet.has(idx)) {
            // Рисуем замочек программно (золотой цвет)
            const lock = new PIXI.Graphics();
            lock.x = pos.x; 
            lock.y = pos.y;
            
            // Тело замка
            lock.beginFill(0xFFD700); // Gold
            lock.lineStyle(1, 0x000000);
            lock.drawRect(-6, -4, 12, 10);
            lock.endFill();
            
            // Дужка замка
            lock.lineStyle(2, 0xFFD700);
            lock.arc(0, -4, 4, Math.PI, 2*Math.PI); 
            
            highlightLayer.addChild(lock);
        }
    });
    
    g.endFill();
    highlightLayer.addChildAt(g, 0); // Добавляем графику тайлов на дно слоя подсветки
};

// При снятии выделения (closeCity) вызываем window.highlightWorkedPlots([], 0)

// --- ИНИЦИАЛИЗАЦИЯ ---

let currentMapState = []; // Массив тайлов (актуальное состояние)

window.initPixiApp = function(data) {
    globalReplayData = data;
    staticMapData = data.header.staticMap;
    turnsData = data.turns;

    const container = document.getElementById('pixi-container');

    // === ИСПРАВЛЕНИЕ: ОЧИСТКА СТАРОГО ПРИЛОЖЕНИЯ ===
    if (app) {
        // Уничтожаем старый app, очищаем сцену, но ОСТАВЛЯЕМ текстуры в памяти (texture: false)
        // чтобы не перегружать их каждый раз и не получать черные квадраты
        app.destroy(true, { children: true, texture: false, baseTexture: false });
        app = null;
    }
    // ================================================

    // Инициализируем состояние копией статики
    currentMapState = JSON.parse(JSON.stringify(staticMapData.tiles));
    
    // Удаляем старый канвас если был (на случай, если destroy не удалил canvas из DOM)
    if (container.firstChild) container.removeChild(container.firstChild);

    app = new PIXI.Application({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundColor: 0x111111,
        antialias: true,
        resolution: window.devicePixelRatio || 1, // High DPI support
        autoDensity: true
    });
    container.appendChild(app.view);

    mapContainer = new PIXI.Container();
    app.stage.addChild(mapContainer);

    // === СОЗДАЕМ СЛОИ (ПОРЯДОК ВАЖЕН!) ===
    baseTerrainLayer = new PIXI.Container();    // 1. Земля
    gridLayer = new PIXI.Container();           // 3. Сетка
    territoryLayer = new PIXI.Container();      // 2. Границы (Линии)
    improvementsLayer = new PIXI.Container(); // Фермы, Шахты
    featuresLayer = new PIXI.Container();       // 4. Леса/Джунгли
    highlightLayer = new PIXI.Container(); //обработка тайлов жителями
    hillsLayer = new PIXI.Container();          // 4. Холмы и Горы (Поверх лесов)
    citiesLayer = new PIXI.Container();         // 5. Города (подложка)
    
    // 6. Иконки (поверх городов)
    iconLayerRes = new PIXI.Container();
    iconLayerCiv = new PIXI.Container();
    iconLayerImprovements = new PIXI.Container();
    iconLayerMilitary = new PIXI.Container();
    yieldsLayer = new PIXI.Container();

    // Добавляем в контейнер
    mapContainer.addChild(baseTerrainLayer);
    mapContainer.addChild(gridLayer);
    mapContainer.addChild(territoryLayer);
    mapContainer.addChild(featuresLayer);
    mapContainer.addChild(hillsLayer);
    mapContainer.addChild(highlightLayer); //обработка тайлов жителями
    mapContainer.addChild(citiesLayer);
    
    mapContainer.addChild(iconLayerRes);
    mapContainer.addChild(iconLayerCiv);
    mapContainer.addChild(iconLayerImprovements);
    mapContainer.addChild(iconLayerMilitary);
    mapContainer.addChild(yieldsLayer);

// --- НАСТРОЙКА КАМЕРЫ ---
    // 2. Начальный зум (чуть крупнее)
    const startScale = 1.3; // Было 0.6, сделали поближе
    mapContainer.scale.set(startScale);

    setupInteraction();
    drawStaticTerrain();
    
    // Сначала рисуем 0-й ход, чтобы появились объекты
    window.updatePixiTurn(0);

    // 3. Умная центровка: Ищем столицу первого игрока
    // (Делаем это после updatePixiTurn, чтобы данные городов были доступны во Vue, если нужно,
    // но здесь мы берем напрямую из turnsData[0])
    const turn0 = turnsData[0];
    let startX = staticMapData.width / 2;
    let startY = staticMapData.height / 2;
    
    // Ищем первого живого мажорного игрока и его город
    if (turn0 && turn0.cities) {
        // Пытаемся найти игрока 0 (обычно человек)
        let firstCity = turn0.cities.find(c => c.owner === 0);
        // Если нет, берем первый попавшийся город
        if (!firstCity && turn0.cities.length > 0) firstCity = turn0.cities[0];

        if (firstCity) {
            startX = firstCity.x;
            startY = firstCity.y;
            console.log(`Centering on city: ${firstCity.name} (${startX}, ${startY})`);
        }
    }

    // Применяем центровку
    window.moveCameraTo(startX, startY);

    setupInteraction();
    drawStaticTerrain();
    window.updatePixiTurn(0);
};

// Функция переключения режима из Vue
window.setIconMode = function(mode) {
    currentIconMode = mode;
    // Pixi не перерисовывается сам, но Vue вызовет updateMap -> updatePixiTurn
};

// --- РАБОТА С ТЕКСТУРАМИ ---

// Генератор шахматки (Missing Texture)
function getMissingTexture() {
    if (textureCache['__MISSING__']) return textureCache['__MISSING__'];
    
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    // Фиолетовый и Черный
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0,0,32,32); ctx.fillRect(32,32,32,32);
    ctx.fillStyle = '#000000'; ctx.fillRect(32,0,32,32); ctx.fillRect(0,32,32,32);
    
    const tex = PIXI.Texture.from(canvas);
    textureCache['__MISSING__'] = tex;
    return tex;
}

function getSpriteFromAsset(assetName, w, h) {
    // 1. Если имени нет - сразу возвращаем null (пустоту)
    if (!assetName) {
        // Раскомментируй для отладки, если снова пропадут текстуры
        // console.warn("getSpriteFromAsset called with empty name!"); 
        return null;
    }

    let tex = null;
    
    // 2. Пытаемся найти в маппинге
    if (window.ASSET_MAP && window.ASSET_MAP[assetName]) {
        const path = window.ASSET_MAP[assetName];
        tex = textureCache[path];
        if (!tex) {
            tex = PIXI.Texture.from(path);
            textureCache[path] = tex;
        }
    }

    // 3. Если текстура не найдена — берем Missing Texture
    if (!tex) {
        tex = getMissingTexture();
    }

    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.width = w;
    sprite.height = h;
    return sprite;
}

// --- ОТРИСОВКА СТАТИКИ (ЛАНДШАФТ) ---

function drawStaticTerrain() {
    baseTerrainLayer.removeChildren();
    gridLayer.removeChildren();
    featuresLayer.removeChildren();
    hillsLayer.removeChildren(); // Очищаем новый слой

    const gridG = new PIXI.Graphics();
    gridG.lineStyle(1, 0x000000, 0.3);

    staticMapData.tiles.forEach((tile, index) => {
        let q = tile.x !== undefined ? tile.x : index % staticMapData.width;
        let r = tile.y !== undefined ? tile.y : Math.floor(index / staticMapData.width);
        const pos = getHexPosition(q, r);

        // 1. TERRAIN (Ландшафт - Подложка)
        // Рисуем ВСЕГДА, даже если это гора. Гора просто встанет сверху.
        let tDef = globalReplayData.header.dictionary.terrains[tile.t];
        let tName = tDef ? tDef.type : null; // Берем TYPE!
        
        const tSprite = getSpriteFromAsset(tName, HEX_WIDTH*1.05, HEX_HEIGHT*1.05);
        if (tSprite) {
            tSprite.x = pos.x; tSprite.y = pos.y;
            
            const mask = new PIXI.Graphics();
            mask.beginFill(0xffffff);
            drawHexPoly(mask, 0, 0, HEX_RADIUS);
            mask.endFill();
            mask.x = pos.x; mask.y = pos.y;
            
            tSprite.mask = mask;
            baseTerrainLayer.addChild(mask);
            baseTerrainLayer.addChild(tSprite);
        }

        // 2. FEATURES (Лес/Джунгли) - Рисуем ПЕРЕД холмами
        if (tile.f >= 0) {
            const fDef = globalReplayData.header.dictionary.features[tile.f];
            const fName = fDef ? fDef.type : null;
            const fSprite = getSpriteFromAsset(fName, HEX_WIDTH*1.05, HEX_HEIGHT*1.05);
            if (fSprite) {
                fSprite.x = pos.x; fSprite.y = pos.y;
                featuresLayer.addChild(fSprite);
            }
        }

        // 3. HILLS & MOUNTAINS (Холмы и Горы) - Рисуем в hillsLayer (ПОВЕРХ всего)
        
        // Гора (PlotType = 0)
        if (tile.p === 0) {
            const mSprite = getSpriteFromAsset("TERRAIN_MOUNTAIN", HEX_WIDTH*1.05, HEX_HEIGHT*1.05);
            if (mSprite) {
                mSprite.x = pos.x; mSprite.y = pos.y;
                hillsLayer.addChild(mSprite);
            }
        }
        // Холм (PlotType = 1)
        else if (tile.p === 1) {
            const hSprite = getSpriteFromAsset("TERRAIN_HILL", HEX_WIDTH, HEX_HEIGHT);
            if (hSprite) {
                hSprite.x = pos.x; hSprite.y = pos.y;
                hillsLayer.addChild(hSprite);
            }
        }

        // 4. GRID
        const path = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i + 30);
            path.push(pos.x + HEX_RADIUS * Math.cos(angle)); 
            path.push(pos.y + HEX_RADIUS * Math.sin(angle));
        }
        gridG.drawPolygon(path);
    });
    gridLayer.addChild(gridG);
}


// --- ГЛАВНЫЙ ЦИКЛ ОБНОВЛЕНИЯ (ДИНАМИКА) ---

window.updatePixiTurn = function(turnIndex) {
    // Очистка динамических слоев
    territoryLayer.removeChildren();
    iconLayerRes.removeChildren();
    iconLayerCiv.removeChildren();
    iconLayerImprovements.removeChildren();
    iconLayerMilitary.removeChildren();
    citiesLayer.removeChildren();

    highlightLayer.removeChildren(); 

    featuresLayer.removeChildren();

    yieldsLayer.removeChildren();

    const turn = turnsData[turnIndex];
    if (!turn) return;

    // Получаем актуальное состояние тайлов (ландшафт, ресурсы, улучшения) через умный кэш
    const tileState = getMapStateAtTurn(turnIndex);

    if (window.appVue && window.appVue.showYields) {
        drawYieldsGlobal(tileState);
    }

    // === 2. ОТРИСОВКА ФИЧ (ЛЕСА) ===
    // Теперь мы рисуем их каждый ход заново, так как лес могут вырубить
    Object.keys(tileState).forEach(idxStr => {
        const idx = parseInt(idxStr);
        const state = tileState[idx];
        
        // Рисуем Лес/Джунгли
        if (state.f >= 0) {
            const fDef = globalReplayData.header.dictionary.features[state.f];
            const fName = fDef ? fDef.type : null;
            const q = idx % staticMapData.width;
            const r = Math.floor(idx / staticMapData.width);
            const pos = getHexPosition(q, r);
            
            const fSprite = getSpriteFromAsset(fName, HEX_WIDTH, HEX_HEIGHT);
            if (fSprite) {
                fSprite.x = pos.x; fSprite.y = pos.y;
                featuresLayer.addChild(fSprite);
            }
        }
    });

    // === 1. ГРАНИЦЫ (OUTLINE) ===
    drawTerritoryBorders(turn.territory);

    // === 2. ГОРОДА ===
    turn.cities.forEach(city => {
        const pos = getHexPosition(city.x, city.y);
        const playerColor = getPlayerColorInt(city.owner);
        
        const g = new PIXI.Container();
        g.x = pos.x; g.y = pos.y;

        // --- 1. ИКОНКА ГОРОДА (Вместо квадрата) ---
        // Рисуем под городами, поэтому добавляем первой
        const cityIcon = getSpriteFromAsset("UI_CITY_ICON", 57, 57); // Размер можно подгонять
        if (cityIcon) {
            // cityIcon.tint = playerColor; // Подкрашиваем иконку в цвет игрока
            cityIcon.y = 0; // Чуть опускаем, чтобы сидела на тайле
            g.addChild(cityIcon);
            
            // Интерактив на иконку
            cityIcon.eventMode = 'static';
            cityIcon.cursor = 'pointer';
            cityIcon.on('pointerdown', () => {
                if (window.appVue) window.appVue.selectCity(city.id, city.owner);
            });
        }

        // --- 2. ТАБЛИЧКА С ИМЕНЕМ (Nameplate) ---
        // Контейнер для таблички (висит над городом)
        const nameplate = new PIXI.Container();
        nameplate.y = -35; // Высота над городом

        // Хак для четкости: Шрифт огромный, scale маленький
        const FONT_SCALE_FACTOR = 0.4;
        const BASE_FONT_SIZE = 32; // Рисуем крупно (было 14)

        // Стиль текста (размеры увеличены)
        const nameStyle = { fontFamily: 'Segoe UI', fontSize: BASE_FONT_SIZE, fill: 0xffffff, fontWeight: 'bold' };
        const popStyle = { fontFamily: 'Segoe UI', fontSize: BASE_FONT_SIZE, fill: 0x00ff00, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 4 };

        // Текстовые объекты
        const txtName = new PIXI.Text(city.name, nameStyle);
        const txtPop = new PIXI.Text(String(city.pop), popStyle); 
        
        // Сразу применяем scale, чтобы вернуть к нормальному визуальному размеру
        txtName.scale.set(FONT_SCALE_FACTOR);
        txtPop.scale.set(FONT_SCALE_FACTOR);
        
        // Звездочка столицы
        let starSprite = null;
        if (city.isCapital) {
            starSprite = getSpriteFromAsset("UI_CAPITAL_STAR", 22, 22);
        }

        // --- РАСЧЕТ РАЗМЕРОВ И ПОЗИЦИЙ ---
        const paddingX = 6;
        const paddingY = 2;
        const elementGap = 0;
        
        let contentWidth = txtPop.width + elementGap + txtName.width;
        if (starSprite) contentWidth += starSprite.width + elementGap;

        const bgW = contentWidth + paddingX * 2;
        const bgH = Math.max(txtName.height, txtPop.height) + paddingY * 2;

        // Фон (Цвет цивилизации)
        const bg = new PIXI.Graphics();
        bg.beginFill(playerColor, 0.85); // 0.85 - небольшая прозрачность
        bg.lineStyle(1, 0x000000, 0.5); // Тонкая обводка
        bg.drawRoundedRect(-bgW / 2, -bgH / 2, bgW, bgH, 4);
        bg.endFill();
        
        // Добавляем фон
        nameplate.addChild(bg);

        // Позиционируем элементы (центрируем всё хозяйство)
        let cursorX = -contentWidth / 2;

        // 1. Популяция (Слева)
        txtPop.anchor.set(0, 0.5);
        txtPop.x = cursorX; 
        txtPop.y = 0;
        nameplate.addChild(txtPop);
        cursorX += txtPop.width + elementGap;

        // 2. Звезда (Если есть)
        if (starSprite) {
            starSprite.anchor.set(0, 0.5);
            starSprite.x = cursorX;
            starSprite.y = 0; // Чуть поправить если криво
            nameplate.addChild(starSprite);
            cursorX += starSprite.width + elementGap;
        }

        // 3. Имя города
        txtName.anchor.set(0, 0.5);
        txtName.x = cursorX;
        txtName.y = 0;
        nameplate.addChild(txtName);

        // Добавляем табличку в группу города
        g.addChild(nameplate);

        // Интерактив и на табличку тоже
        bg.eventMode = 'static';
        bg.cursor = 'pointer';
        bg.on('pointerdown', () => {
            if (window.appVue) window.appVue.selectCity(city.id, city.owner);
        });

        citiesLayer.addChild(g);
    });

    // === 3. ИКОНКИ (СИСТЕМА 4-Х КВАДРАНТОВ) ===
    // Собираем объекты по тайлам
    const tileObjects = {}; // "x,y" -> { mil:[], civ:[], res:[], misc:[] }

    // А. Ресурсы (из tileState!)
    Object.keys(tileState).forEach(idxStr => {
        const idx = parseInt(idxStr);
        const state = tileState[idx];
        const q = idx % staticMapData.width;
        const r = Math.floor(idx / staticMapData.width);
        const key = getTileKey(q, r);
        
        if (!tileObjects[key]) tileObjects[key] = { mil:[], civ:[], res:[], imp:[] };
        
        // Ресурс
        if (state.r >= 0) {
            // Было: const rName = globalReplayData.header.dictionary.resources[state.r];
            const rDef = globalReplayData.header.dictionary.resources[state.r];
            // Важно: в tileObjects мы кладем имя для иконки, значит тоже TYPE
            if (rDef) tileObjects[key].res.push({ name: rDef.type });
        }
        
        // Улучшение (Ферма, Шахта)
        // Улучшение
        if (state.i >= 0) {
            const iDef = globalReplayData.header.dictionary.improvements[state.i];
            if (iDef) tileObjects[key].imp.push({ name: iDef.type });
        }
    });

    // Б. Руины / Лагеря (Legacy mapObjects или дубли?)
    // Если в Lua мы теперь шлем всё через mapChanges (Improvement), то блок mapObjects можно убрать,
    // ЧТОБЫ НЕ БЫЛО ДУБЛЕЙ.
    // Но Руины (Goody Huts) иногда не считаются Improvement'ом в базе, а "спец объектом".
    // Проверь: если mapObjects приходят - добавляй их.
    if (turn.mapObjects) {
        turn.mapObjects.forEach(obj => {
            const key = getTileKey(obj.x, obj.y);
            if (!tileObjects[key]) tileObjects[key] = { mil:[], civ:[], res:[], imp:[] };
            
            let name = null;
            if (obj.type === "RUIN") name = "IMPROVEMENT_GOODY_HUT";
            if (obj.type === "CAMP") name = "IMPROVEMENT_BARBARIAN_CAMP";
            
            // Проверка на дубликаты (если уже есть такое улучшение из tileState)
            const exists = tileObjects[key].imp.some(x => x.name === name);
            if (name && !exists) {
                tileObjects[key].imp.push({ name: name });
            }
        });
    }

    // В. Юниты
    turn.units.forEach(u => {
        const key = getTileKey(u.x, u.y);
        if (!tileObjects[key]) tileObjects[key] = { mil:[], civ:[], res:[], misc:[] };
        
        const uDef = globalReplayData.header.dictionary.units[u.type];
        const uTypeName = uDef ? uDef.type : "UNIT_UNKNOWN"; // TYPE для логики и ассетов
        const isCiv = CIVILIAN_UNITS.includes(uTypeName);
        
        const unitObj = { name: uTypeName, owner: u.owner };
        if (isCiv) tileObjects[key].civ.push(unitObj);
        else tileObjects[key].mil.push(unitObj);
    });

    // === 4. ОТРИСОВКА ИКОНОК (Updated Layout) ===
    Object.keys(tileObjects).forEach(key => {
        const [qx, ry] = key.split(',').map(Number);
        const pos = getHexPosition(qx, ry);
        const objs = tileObjects[key];

        // Функция отрисовки (с фильтром для Варваров)
        const drawIcon = (obj, layer, dx, dy, scale, showBg, isUnit) => {
            const sprite = getSpriteFromAsset(obj.name, HEX_WIDTH, HEX_WIDTH);
            if (!sprite) return;
            
            const cont = new PIXI.Container();
            cont.x = pos.x + dx; 
            cont.y = pos.y + dy;
            cont.scale.set(scale);

            if (showBg && obj.owner !== undefined) {
                const bg = new PIXI.Graphics();
                bg.beginFill(getPlayerColorInt(obj.owner));
                bg.drawCircle(0, 0, HEX_WIDTH/2);
                cont.addChild(bg);
            }

            // Фильтр: Если юнит И НЕ Варвар (ID 63)
            if (isUnit && obj.owner !== 63) {
                sprite.filters = [unitColorFilter];
            }

            cont.addChild(sprite);
            layer.addChild(cont);
        };

        const MODE = currentIconMode;
        
        // Priority Modes
        if (MODE === 'military' && objs.mil.length > 0) drawIcon(objs.mil[0], iconLayerMilitary, 0, 0, 0.7, true, true);
        else if (MODE === 'civilian' && objs.civ.length > 0) drawIcon(objs.civ[0], iconLayerCiv, 0, 0, 0.7, true, true);
        else if (MODE === 'resource' && objs.res.length > 0) drawIcon(objs.res[0], iconLayerRes, 0, 0, 1.05, false, false);
        else if (MODE === 'improvements' && objs.imp.length > 0) drawIcon(objs.imp[0], iconLayerImprovements, 0, 0, 1.05, false, false);
        
        // Default (4 Quadrants)
        else if (MODE === 'default') {
            const offset = HEX_RADIUS * 0.55;
            const scale = 0.40;
            
            // Top: Military
            if (objs.mil.length > 0) drawIcon(objs.mil[0], iconLayerMilitary, 0, -offset, scale, true, true);
            
            // Right: Resource
            if (objs.res.length > 0) drawIcon(objs.res[0], iconLayerRes, offset, 0, scale*1.4, false, false);
            
            // Bottom: Civilian
            if (objs.civ.length > 0) drawIcon(objs.civ[0], iconLayerCiv, 0, offset, scale, true, true);
            
            // Left: Improvement (Farm/Mine/Camp)
            if (objs.imp.length > 0) drawIcon(objs.imp[0], iconLayerImprovements, -offset, 0, scale*1.4, false, false);
        }
    });

    // === ФИНАЛЬНЫЙ БЛОК: Восстановление выделения ===
    // Если во Vue выбран город (сохранены ID), ищем его состояние в НОВОМ ходу
    if (window.appVue && window.appVue.selectedCityId !== null) {
        const selId = window.appVue.selectedCityId;
        const selOwner = window.appVue.selectedCityOwner;

        // Ищем город в массиве текущего хода
        const cityData = turn.cities.find(c => c.id === selId && c.owner === selOwner);

        // Если город найден (не разрушен) и у него есть данные обработки
        if (cityData && cityData.worked) {
            const ownerColor = parseInt(window.appVue.getPlayerColor(selOwner).replace('#', ''), 16);
            
            // Вызываем отрисовку для новых координат locked/worked
            window.highlightWorkedPlots(
                cityData.worked || [], 
                cityData.locked || [], 
                ownerColor
            );
        }
    }
};


// === ОТРИСОВКА YIELDS ===

function drawYieldsGlobal(tileState) {
    // Список типов в порядке отображения: Food, Prod, Gold, Sci, Cult, Faith
    // Соответствует индексам Civ5 YieldTypes: 0, 1, 2, 4, 5, 8 ?? Нет, в Lua мы сохраняли 0-5 подряд.
    // Lua: 0=Food, 1=Prod, 2=Gold, 3=Science, 4=Culture, 5=Faith (мы мапили итератором 0-5)
    const YIELD_ASSETS = [
        "YIELD_FOOD", "YIELD_PRODUCTION", "YIELD_GOLD", 
        "YIELD_SCIENCE", "YIELD_CULTURE", "YIELD_FAITH"
    ];

    Object.keys(tileState).forEach(idxStr => {
        const idx = parseInt(idxStr);
        const state = tileState[idx];
        
        if (!state.y) return; // Нет данных о доходах

        // Фильтруем нулевые значения
        const activeYields = [];
        state.y.forEach((val, typeIdx) => {
            if (val > 0) {
                activeYields.push({ typeIdx: typeIdx, val: val });
            }
        });

        if (activeYields.length === 0) return;

        const q = idx % staticMapData.width;
        const r = Math.floor(idx / staticMapData.width);
        const pos = getHexPosition(q, r);

        // Контейнер для всех иконок клетки
        const cellCont = new PIXI.Container();
        cellCont.x = pos.x; 
        cellCont.y = pos.y;

        // Параметры верстки
        const ICON_SIZE = 7; // Размер маленькой иконки
        const GAP = 4;        // Отступ между группами
        let currentX = 0;

        // 1. Сначала считаем общую ширину, чтобы отцентровать
        let totalWidth = 0;
        const groups = activeYields.map(item => {
            let width = 0;
            // Логика ширины группы
            if (item.val < 5) {
                // 1 -> 1 иконка
                // 2 -> 1 иконка (вертикально, ширина та же)
                // 3 -> треугольник (чуть шире, ~1.5 ширины)
                // 4 -> квадрат ( ~1.5 ширины)
                if (item.val <= 2) width = ICON_SIZE;
                else width = ICON_SIZE * 1.6;
            } else {
                // 5+ -> Большая иконка
                width = ICON_SIZE * 2;
            }
            totalWidth += width;
            return { ...item, width: width };
        });

        totalWidth += (groups.length - 1) * GAP;

        // Начальная точка X (сдвигаем влево на половину ширины)
        currentX = -totalWidth / 2;

        // 2. Рисуем группы
        groups.forEach(group => {
            const assetName = YIELD_ASSETS[group.typeIdx];
            
            // Центр группы по X
            const groupCenterX = currentX + group.width / 2;
            
            if (group.val >= 5) {
                // === ВАРИАНТ 5+: Большая иконка + Цифра ===
                const sprite = getSpriteFromAsset(assetName, ICON_SIZE * 1.8, ICON_SIZE * 1.8);
                if (sprite) {
                    sprite.x = groupCenterX;
                    sprite.y = -2; // Чуть выше центра
                    cellCont.addChild(sprite);

                    const text = new PIXI.Text(group.val, {
                        fontFamily: 'Arial', fontSize: 10, fill: 0xffffff, 
                        stroke: 0x000000, strokeThickness: 3, fontWeight: 'bold'
                    });
                    text.anchor.set(0.5, 0);
                    text.y = 4; 
                    text.x = groupCenterX;
                    cellCont.addChild(text);
                }
            } else {
                // === ВАРИАНТЫ 1-4 ===
                // Координаты относительно groupCenterX и 0
                const offsets = [];
                const s = ICON_SIZE; 
                
                if (group.val === 1) {
                    offsets.push({x:0, y:0});
                } else if (group.val === 2) {
                    offsets.push({x:0, y:-s*0.45}, {x:0, y:s*0.45});
                } else if (group.val === 3) {
                    // Треугольник
                    offsets.push({x:0, y:-s*0.4}, {x:-s*0.35, y:s*0.3}, {x:s*0.35, y:s*0.3});
                } else if (group.val === 4) {
                    // Ромб/Квадрат
                    offsets.push({x:0, y:-s*0.5}, {x:-s*0.45, y:0}, {x:s*0.45, y:0}, {x:0, y:s*0.5});
                }

                offsets.forEach(off => {
                    const sprite = getSpriteFromAsset(assetName, s, s);
                    if (sprite) {
                        sprite.x = groupCenterX + off.x;
                        sprite.y = off.y;
                        cellCont.addChild(sprite);
                    }
                });
            }

            currentX += group.width + GAP;
        });

        yieldsLayer.addChild(cellCont);
    });
}

// --- АЛГОРИТМ ГРАНИЦ (EDGE DETECTION) ---

function drawTerritoryBorders(territoryArray) {
    if (!territoryArray) return;
    
    const g = new PIXI.Graphics();
    const W = staticMapData.width;
    const H = staticMapData.height;
    
    // Создаем Map для быстрого доступа
    const territoryMap = {};
    territoryArray.forEach((owner, idx) => {
        territoryMap[idx] = owner;
    });

    // ПОРЯДОК СОСЕДЕЙ ДЛЯ ОТРИСОВКИ (По часовой стрелке, начиная с Востока)
    // 0: East, 1: South-East, 2: South-West, 3: West, 4: North-West, 5: North-East
    
    // В Civ 5 (0,0) внизу. Значит:
    // Север (North) = dr: +1
    // Юг (South)   = dr: -1
    
    const getNeighbors = (isOdd) => isOdd ? [
        { dq: 1, dr: 0 },  // 0: East
        { dq: 1, dr: -1 }, // 1: South-East (Visual Bottom-Right) -> Civ Odd (dr -1, dq +1)
        { dq: 0, dr: -1 }, // 2: South-West (Visual Bottom-Left)  -> Civ Odd (dr -1, dq 0)
        { dq: -1, dr: 0 }, // 3: West
        { dq: 0, dr: 1 },  // 4: North-West (Visual Top-Left)     -> Civ Odd (dr +1, dq 0)
        { dq: 1, dr: 1 }   // 5: North-East (Visual Top-Right)    -> Civ Odd (dr +1, dq +1)
    ] : [
        { dq: 1, dr: 0 },  // 0: East
        { dq: 0, dr: -1 }, // 1: South-East -> Civ Even (dr -1, dq 0)
        { dq: -1, dr: -1 },// 2: South-West -> Civ Even (dr -1, dq -1)
        { dq: -1, dr: 0 }, // 3: West
        { dq: -1, dr: 1 }, // 4: North-West -> Civ Even (dr +1, dq -1)
        { dq: 0, dr: 1 }   // 5: North-East -> Civ Even (dr +1, dq 0)
    ];

    // Углы граней (Pixi координаты: Y вниз, 0 градусов = 3 часа)
    // Должны строго соответствовать порядку getNeighbors выше
    const EDGE_ANGLES = [
        [330, 30],  // 0: East Edge (Right)
        [30, 90],   // 1: South-East Edge (Bottom-Right)
        [90, 150],  // 2: South-West Edge (Bottom-Left)
        [150, 210], // 3: West Edge (Left)
        [210, 270], // 4: North-West Edge (Top-Left)
        [270, 330]  // 5: North-East Edge (Top-Right)
    ];

    territoryArray.forEach((owner, idx) => {
        if (owner === -1) return; // Ничья земля

        const q = idx % W;
        const r = Math.floor(idx / W);
        const center = getHexPosition(q, r);
        const color = getPlayerColorInt(owner);

        const isOdd = (r % 2) !== 0; 
        const neighbors = getNeighbors(isOdd);

        neighbors.forEach((n, dirIdx) => {
            // Координаты соседа
            let nQ = q + n.dq;
            let nR = r + n.dr;
            
            // Зацикливание карты по X (World Wrap)
            if (nQ < 0) nQ += W;
            if (nQ >= W) nQ -= W;

            let neighborOwner = -1;
            if (nR >= 0 && nR < H) {
                const nIdx = nR * W + nQ;
                neighborOwner = territoryMap[nIdx];
                if (neighborOwner === undefined) neighborOwner = -1;
            }

            // РИСУЕМ ЛИНИЮ ТОЛЬКО ЕСЛИ ВЛАДЕЛЬЦЫ РАЗНЫЕ
            if (owner !== neighborOwner) {
                const angles = EDGE_ANGLES[dirIdx];
                const rRad = HEX_RADIUS; // Радиус описанной окружности
                
                // Вычисляем координаты концов грани
                const a1 = (Math.PI / 180) * angles[0];
                const a2 = (Math.PI / 180) * angles[1];
                
                const x1 = center.x + rRad * Math.cos(a1);
                const y1 = center.y + rRad * Math.sin(a1);
                const x2 = center.x + rRad * Math.cos(a2);
                const y2 = center.y + rRad * Math.sin(a2);

                g.lineStyle(3, color, 0.8);
                g.moveTo(x1, y1);
                g.lineTo(x2, y2);
            }
        });
    });

    territoryLayer.addChild(g);
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function getTileKey(x, y) { return `${x},${y}`; }

function drawHexPoly(g, x, y, r) {
    const path = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i + 30);
        path.push(x + r * Math.cos(angle)); 
        path.push(y + r * Math.sin(angle));
    }
    g.drawPolygon(path);
}

function getHexPosition(q, r) {
    const invR = staticMapData.height - 1 - r; 
    const x = HEX_WIDTH * (q + 0.5 * (r % 2));
    const y = invR * (HEX_RADIUS * 1.5);
    return { 
        x: x - (staticMapData.width * HEX_WIDTH)/2, 
        y: y - (staticMapData.height * HEX_RADIUS * 1.5)/2 
    };
}

function getPlayerColorInt(id) {
    if (id === -1 || id === undefined) return 0x000000;
    if (id === 63) return 0x222222; // Barbarians
    if (id >= 22 && id < 63) return 0x444444; // CS
    
    // Цвета мажоров (Civ 5 style)
    const pal = [
        0xda2020, // 0: Songhai/Austria (Red)
        0x3366cc, // 1: America/France (Blue)
        0xffcc00, // 2: Egypt (Yellow)
        0x00aa00, // 3: India (Green)
        0xcc6600, // 4: England (Orange)
        0x990099, // 5: Rome (Purple)
        0x009999, // 6: Aztec (Cyan)
        0xffffff, // 7: White
        0x888888, // 8: Gray
    ];
    return pal[id % pal.length];
}

// Управление камерой (Zoom/Pan)
function setupInteraction() {
    let isDragging = false;
    let lastPos = null;

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;

    app.stage.on('pointerdown', (e) => {
        isDragging = true;
        lastPos = e.global.clone();
    });

    app.stage.on('pointerup', () => { isDragging = false; });
    app.stage.on('pointerupoutside', () => { isDragging = false; });

    app.stage.on('pointermove', (e) => {
        if (!isDragging) return;
        const newPos = e.global;
        mapContainer.x += newPos.x - lastPos.x;
        mapContainer.y += newPos.y - lastPos.y;
        lastPos = newPos.clone();
    });

    document.getElementById('pixi-container').addEventListener('wheel', (e) => {
        e.preventDefault();
        const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const worldPos = mapContainer.toLocal(new PIXI.Point(e.clientX, e.clientY));
        mapContainer.scale.x *= scaleFactor;
        mapContainer.scale.y *= scaleFactor;
        const newWorldPos = mapContainer.toGlobal(worldPos);
        mapContainer.x -= (newWorldPos.x - e.clientX);
        mapContainer.y -= (newWorldPos.y - e.clientY);
    });
}

window.moveCameraTo = function(q, r) {
    const pos = getHexPosition(q, r);
    mapContainer.x = (app.screen.width / 2) - (pos.x * mapContainer.scale.x);
    mapContainer.y = (app.screen.height / 2) - (pos.y * mapContainer.scale.y);
};