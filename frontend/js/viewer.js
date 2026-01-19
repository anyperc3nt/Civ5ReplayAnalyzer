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
window.highlightWorkedPlots = function(plotIndices, colorInt) {
    highlightLayer.removeChildren();
    
    if (!plotIndices || plotIndices.length === 0) return;

    const g = new PIXI.Graphics();
    g.beginFill(colorInt, 0.4); // Полупрозрачная заливка
    g.lineStyle(2, 0xffffff, 0.6); // Белая обводка

    plotIndices.forEach(idx => {
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
        
        // Опционально: иконку человечка/головы (Citizen) в центре
        // const head = getSpriteFromAsset('CITIZEN_ICON', 16, 16); ...
    });
    g.endFill();
    highlightLayer.addChild(g);
};

// При снятии выделения (closeCity) вызываем window.highlightWorkedPlots([], 0)

// --- ИНИЦИАЛИЗАЦИЯ ---

let currentMapState = []; // Массив тайлов (актуальное состояние)

window.initPixiApp = function(data) {
    globalReplayData = data;
    staticMapData = data.header.staticMap;
    turnsData = data.turns;

    const container = document.getElementById('pixi-container');

    // Инициализируем состояние копией статики
    currentMapState = JSON.parse(JSON.stringify(staticMapData.tiles));
    
    // Удаляем старый канвас если был (для HMR)
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
    territoryLayer = new PIXI.Container();      // 2. Границы (Линии)
    gridLayer = new PIXI.Container();           // 3. Сетка
    highlightLayer = new PIXI.Container(); //обработка тайлов жителями
    improvementsLayer = new PIXI.Container(); // Фермы, Шахты
    featuresLayer = new PIXI.Container();       // 4. Леса/Джунгли
    hillsLayer = new PIXI.Container();          // 4. Холмы и Горы (Поверх лесов)
    citiesLayer = new PIXI.Container();         // 5. Города (подложка)
    
    // 6. Иконки (поверх городов)
    iconLayerRes = new PIXI.Container();
    iconLayerCiv = new PIXI.Container();
    iconLayerImprovements = new PIXI.Container();
    iconLayerMilitary = new PIXI.Container();

    // Добавляем в контейнер
    mapContainer.addChild(baseTerrainLayer);
    mapContainer.addChild(territoryLayer);
    mapContainer.addChild(gridLayer);
    mapContainer.addChild(highlightLayer); //обработка тайлов жителями
    mapContainer.addChild(featuresLayer);
    mapContainer.addChild(hillsLayer);
    mapContainer.addChild(citiesLayer);
    
    mapContainer.addChild(iconLayerRes);
    mapContainer.addChild(iconLayerCiv);
    mapContainer.addChild(iconLayerImprovements);
    mapContainer.addChild(iconLayerMilitary);

    // Центрируем камеру
    const centerX = (staticMapData.width * HEX_WIDTH) / 2;
    const centerY = (staticMapData.height * HEX_RADIUS * 1.5) / 2;
    mapContainer.x = (app.screen.width / 2) - centerX;
    mapContainer.y = (app.screen.height / 2) - centerY;

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
    if (!assetName) return null;

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
        let tName = globalReplayData.header.dictionary.terrains[tile.t];
        
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
            const fName = globalReplayData.header.dictionary.features[tile.f];
            const fSprite = getSpriteFromAsset(fName, HEX_WIDTH, HEX_HEIGHT);
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

    featuresLayer.removeChildren();

    const turn = turnsData[turnIndex];
    if (!turn) return;

    // Получаем актуальное состояние тайлов (ландшафт, ресурсы, улучшения) через умный кэш
    const tileState = getMapStateAtTurn(turnIndex);

    // === 2. ОТРИСОВКА ФИЧ (ЛЕСА) ===
    // Теперь мы рисуем их каждый ход заново, так как лес могут вырубить
    Object.keys(tileState).forEach(idxStr => {
        const idx = parseInt(idxStr);
        const state = tileState[idx];
        
        // Рисуем Лес/Джунгли
        if (state.f >= 0) {
            const fName = globalReplayData.header.dictionary.features[state.f];
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
        const color = getPlayerColorInt(city.owner);
        
        const g = new PIXI.Container();
        g.x = pos.x; g.y = pos.y;

        // Фон названия (полупрозрачный)
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.6);
        bg.drawRoundedRect(-40, -32, 80, 18, 4); 
        bg.endFill();
        
        // High-DPI Текст
        // Создаем текст в 2x размере и сжимаем, чтобы было четко
        const nameText = new PIXI.Text(city.name, {
            fontFamily: 'Segoe UI', fontSize: 24, fill: color,
            fontWeight: 'bold', stroke: 0x000000, strokeThickness: 4,
            lineJoin: 'round'
        });
        nameText.resolution = 2; // Важно для четкости
        nameText.scale.set(0.5); // Возвращаем размер
        nameText.anchor.set(0.5, 1);
        nameText.position.set(0, -16); // Над гексом

        // Квадратик города
        const box = new PIXI.Graphics();
        box.beginFill(0x222222);
        box.lineStyle(2, color);
        box.drawRect(-10, -10, 20, 20);
        
        // Интерактив (Клик по городу)
        box.eventMode = 'static';
        box.cursor = 'pointer';
        box.on('pointerdown', () => {
            if (window.appVue) window.appVue.selectCity(city.id, city.owner); // Передаем ID!
        });

        g.addChild(bg);
        g.addChild(nameText);
        g.addChild(box);
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
            const rName = globalReplayData.header.dictionary.resources[state.r];
            tileObjects[key].res.push({ name: rName });
        }
        
        // Улучшение (Ферма, Шахта)
        if (state.i >= 0) {
            const iName = globalReplayData.header.dictionary.improvements[state.i];
            // Игнорируем "IMPROVEMENT_BARBARIAN_CAMP" и "RUINS" здесь, 
            // так как они приходят отдельно в mapObjects? 
            // НЕТ! В новом Lua мы НЕ шлем mapObjects отдельно, мы шлем их как улучшения тайла?
            // А, стоп. В Lua v2.0 mapObjects (Camp/Ruin) собирались отдельно.
            // Но теперь мы добавили 'mapChanges' с полем 'i' (Improvement).
            // Лагерь варваров - это тоже Improvement. 
            // Если Lua шлет Improvement ID, то мы можем рисовать его отсюда.
            
            // Если имя валидное - добавляем
            if (iName) tileObjects[key].imp.push({ name: iName });
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
        
        const uTypeName = globalReplayData.header.dictionary.units[u.type];
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
};

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