// Глобальные переменные
let app;
let mapContainer; 

// === НОВЫЕ СЛОИ ===
let baseTerrainLayer, gridLayer, featuresLayer, citiesLayer, unitsLayer; 

let staticMapData = null;
let turnsData = null;
let globalReplayData = null; 
const textureCache = {};

const HEX_RADIUS = 20;
const HEX_WIDTH = HEX_RADIUS * Math.sqrt(3);
const HEX_HEIGHT = HEX_RADIUS * 2;

const TERRAIN_COLORS = {
    0: 0x497f37, 1: 0x888b39, 2: 0xe4d99e, 3: 0x858e8b, 
    4: 0xffffff, 5: 0x3a738c, 6: 0x1a4159,
};

window.initPixiApp = function(data) {
    globalReplayData = data;
    staticMapData = data.header.staticMap;
    turnsData = data.turns;

    const container = document.getElementById('pixi-container');
    app = new PIXI.Application({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundColor: 0x111111,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
    });
    container.appendChild(app.view);

    mapContainer = new PIXI.Container();
    const centerX = (staticMapData.width * HEX_WIDTH) / 2;
    const centerY = (staticMapData.height * HEX_RADIUS * 1.5) / 2;
    mapContainer.x = (app.screen.width / 2) - centerX;
    mapContainer.y = (app.screen.height / 2) - centerY;
    app.stage.addChild(mapContainer);

    // === СОЗДАЕМ И ДОБАВЛЯЕМ СЛОИ В СТРОГОМ ПОРЯДКЕ ===
    baseTerrainLayer = new PIXI.Container();
    gridLayer = new PIXI.Container();
    featuresLayer = new PIXI.Container();
    resourcesLayer = new PIXI.Container();
    citiesLayer = new PIXI.Container();
    unitsLayer = new PIXI.Container();
    
    // Кто добавлен позже — тот выше (Z-index)
    mapContainer.addChild(baseTerrainLayer); // Самый низ
    mapContainer.addChild(gridLayer);        // Сетка поверх земли
    mapContainer.addChild(featuresLayer);    // Леса поверх сетки
    mapContainer.addChild(resourcesLayer); // <--- ДОБАВЛЯЕМ
    mapContainer.addChild(citiesLayer);      // Города
    mapContainer.addChild(unitsLayer);       // Юниты (Самый верх)

    drawStaticTerrain();
    setupInteraction();
    window.updatePixiTurn(0);
};

function getSpriteFromAsset(assetName, width, height) {
    if (!window.ASSET_MAP || !assetName) return null;
    const path = window.ASSET_MAP[assetName];
    if (!path) return null;

    let tex = textureCache[path];
    if (!tex) { 
        tex = PIXI.Texture.from(path); 
        textureCache[path] = tex; 
    }
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.width = width;
    sprite.height = height;
    return sprite;
}

// === ОТРИСОВКА ===

function getHexPosition(q, r) {
    // Инвертируем Y для Pixi
    // (0,0) в Civ5 - это Bottom-Left.
    // В Pixi (0,0) - Top-Left.
    const invertedR = staticMapData.height - 1 - r;
    
    // Смещение Odd-R (или Odd-Q? Civ5 вроде Odd-R "Pointy Top")
    // x = size * sqrt(3) * (q + 0.5 * (r&1))
    // y = size * 3/2 * r
    const x = HEX_WIDTH * (q + 0.5 * (r % 2));
    const y = invertedR * (HEX_RADIUS * 1.5);
    
    // Центрируем карту относительно (0,0) контейнера
    const mapPixelWidth = staticMapData.width * HEX_WIDTH;
    const mapPixelHeight = staticMapData.height * HEX_RADIUS * 1.5;
    
    return {
        x: x - mapPixelWidth / 2,
        y: y - mapPixelHeight / 2
    };
}

function drawStaticTerrain() {
    baseTerrainLayer.removeChildren();
    gridLayer.removeChildren();
    featuresLayer.removeChildren();
    resourcesLayer.removeChildren(); // Очистка нового слоя

    const gridGraphics = new PIXI.Graphics();
    gridGraphics.lineStyle(1, 0x000000, 0.4);

    staticMapData.tiles.forEach((tile, index) => {
        let q = tile.x;
        let r = tile.y;
        if (q === undefined) {
            q = index % staticMapData.width;
            r = Math.floor(index / staticMapData.width);
        }
        const pos = getHexPosition(q, r);

        // --- 0. ЛОГИКА ТИПА ПЛОТА (ГОРЫ И ХОЛМЫ) ---
        // PlotType: 0=Mountain, 1=Hills, 2=Land, 3=Ocean
        let isMountain = tile.p === 0;
        let isHill = tile.p === 1;

        // --- 1. БАЗОВЫЙ ЛАНДШАФТ (TERRAIN) ---
        // Если это Гора - часто рисуют просто текстуру горы.
        // Если Холм - рисуем базовый ландшафт (Луг), а сверху наложим холм.
        
        let terrainName = globalReplayData.header.dictionary.terrains[tile.t];
        
        // ХАК: Если это Гора, движок может вернуть Terrain "Grass", но нам нужна текстура Горы.
        // Обычно в словаре есть TERRAIN_MOUNTAIN, но tile.t указывает на подложку.
        // Попробуем найти ассет горы вручную, если plot=0
        if (isMountain) {
             // Пытаемся подменить имя для поиска ассета
             // (Нужно убедиться, что TERRAIN_MOUNTAIN есть в asset_map.js)
             terrainName = "TERRAIN_MOUNTAIN"; 
        }

        const tSprite = getSpriteFromAsset(terrainName, HEX_WIDTH * 1.05, HEX_HEIGHT * 1.05);

        if (tSprite) {
            tSprite.x = pos.x; tSprite.y = pos.y;
            
            // Маска для гекса
            const mask = new PIXI.Graphics();
            mask.beginFill(0xffffff);
            const maskPath = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i + 30);
                maskPath.push(HEX_RADIUS * Math.cos(angle)); 
                maskPath.push(HEX_RADIUS * Math.sin(angle));
            }
            mask.drawPolygon(maskPath);
            mask.endFill();
            mask.x = pos.x; mask.y = pos.y;
            
            tSprite.mask = mask;
            baseTerrainLayer.addChild(mask);
            baseTerrainLayer.addChild(tSprite);
        } else {
            // Фолбэк цвета
            const g = new PIXI.Graphics();
            let color = TERRAIN_COLORS[tile.t] || 0x333333;
            if (isMountain) color = 0x555555; // Темно-серый для гор
            g.beginFill(color);
            // ... отрисовка гекса ...
            const gPath = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i + 30);
                gPath.push(HEX_RADIUS * Math.cos(angle)); 
                gPath.push(HEX_RADIUS * Math.sin(angle));
            }
            g.drawPolygon(gPath);
            g.endFill();
            g.x = pos.x; g.y = pos.y;
            baseTerrainLayer.addChild(g);
        }

        // --- 1.1 НАКЛАДКА ХОЛМОВ ---
        if (isHill) {
            // Ищем текстуру холма. В словаре игры обычно есть "TERRAIN_HILL".
            // Даже если tile.t = Grass, мы накладываем сверху спрайт холма.
            const hillSprite = getSpriteFromAsset("TERRAIN_HILL", HEX_WIDTH, HEX_HEIGHT);
            if (hillSprite) {
                hillSprite.x = pos.x; hillSprite.y = pos.y;
                // Холмы часто полупрозрачные или требуют режима смешивания, 
                // но для простоты просто рисуем поверх.
                baseTerrainLayer.addChild(hillSprite); 
            } else {
                // Если нет текстуры холма - рисуем символ "^" или затемняем
                // Можно добавить графический индикатор
            }
        }

        // --- 2. ФИЧИ (ЛЕСА, ДЖУНГЛИ) ---
        // tile.f: -1 если нет фичи
        if (tile.f >= 0) { 
            const featureName = globalReplayData.header.dictionary.features[tile.f];
            const fSprite = getSpriteFromAsset(featureName, HEX_WIDTH * 0.9, HEX_HEIGHT * 0.9);
            if (fSprite) {
                fSprite.x = pos.x; fSprite.y = pos.y;
                featuresLayer.addChild(fSprite);
            }
        }

        // --- 3. РЕСУРСЫ ---
        // tile.r: -1 если нет ресурса
        if (tile.r >= 0) {
            const resName = globalReplayData.header.dictionary.resources[tile.r];
            // Ресурсы обычно маленькие иконки (кружочки)
            const rSprite = getSpriteFromAsset(resName, HEX_WIDTH * 0.6, HEX_WIDTH * 0.6);
            if (rSprite) {
                rSprite.x = pos.x; rSprite.y = pos.y;
                resourcesLayer.addChild(rSprite);
            }
        }

        // --- 4. СЕТКА ---
        const path = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i + 30);
            path.push(pos.x + HEX_RADIUS * Math.cos(angle)); 
            path.push(pos.y + HEX_RADIUS * Math.sin(angle));
        }
        gridGraphics.drawPolygon(path);
    });

    gridLayer.addChild(gridGraphics);
}

window.updatePixiTurn = function(turnIndex) {
    // Очищаем динамические слои
    unitsLayer.removeChildren();
    
    const turn = turnsData[turnIndex];
    if (!turn) return;

    // === ЮНИТЫ ===
    turn.units.forEach(unit => {
        const pos = getHexPosition(unit.x, unit.y);

        // Получаем имя юнита: ID -> UNIT_WARRIOR
    const unitName = globalReplayData.header.dictionary.units[unit.type];
    const assetPath = window.ASSET_MAP ? window.ASSET_MAP[unitName] : null;

    if (assetPath) {
        let texture = textureCache[assetPath];
        if (!texture) {
            texture = PIXI.Texture.from(assetPath);
            textureCache[assetPath] = texture;
        }
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        // Иконки юнитов обычно меньше самого тайла
        sprite.width = HEX_WIDTH * 0.8; 
        sprite.height = HEX_WIDTH * 0.8; // Квадратные иконки
        sprite.x = pos.x;
        sprite.y = pos.y;
        
        // Цветной ободок для владельца (можно нарисовать кружок ПОД спрайтом)
        const circle = new PIXI.Graphics();
        const colors = [0xff0000, 0x0000ff, 0x00ff00, 0xffff00];
        circle.beginFill(colors[unit.owner % colors.length]);
        circle.drawCircle(0, 0, HEX_RADIUS * 0.5);
        circle.x = pos.x;
        circle.y = pos.y;
        
        unitsLayer.addChild(circle); // Сначала кружок команды
        unitsLayer.addChild(sprite); // Сверху иконка
    } else {
        // ... старый код с цветными кружками ...
        const g = new PIXI.Graphics();
        const colors = [0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 0x00ffff];
        const color = colors[unit.owner % colors.length];

        g.beginFill(color);
        g.lineStyle(2, 0xffffff);
        g.drawCircle(0, 0, HEX_RADIUS * 0.6); // Рисуем в 0,0 относительно позиции объекта
        g.endFill();
        
        g.x = pos.x;
        g.y = pos.y;

        // Интерактивность (тултип)
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.on('pointerover', () => { g.scale.set(1.2); });
        g.on('pointerout', () => { g.scale.set(1); });

        unitsLayer.addChild(g);
    }
        
    });

    // === ГОРОДА ===
    citiesLayer.removeChildren(); // Перерисовываем города (они могут менять население/HP)
    turn.cities.forEach(city => {
        const pos = getHexPosition(city.x, city.y);
        
        // Квадратик для города
        const g = new PIXI.Graphics();
        g.beginFill(0x888888);
        g.lineStyle(2, 0xffffff);
        g.drawRect(-10, -10, 20, 20);
        g.endFill();
        g.x = pos.x;
        g.y = pos.y;
        
        // Текст названия (Pixi Text)
        const text = new PIXI.Text(city.name, {
            fontFamily: 'Arial', fontSize: 12, fill: 0xffffff,
            stroke: 0x000000, strokeThickness: 2
        });
        text.anchor.set(0.5, 1.5); // Над городом
        text.x = pos.x;
        text.y = pos.y;

        citiesLayer.addChild(g);
        citiesLayer.addChild(text);
    });
};

// === УПРАВЛЕНИЕ (Zoom/Pan) ===

function setupInteraction() {
    let isDragging = false;
    let lastPos = null;

    // Фон (весь экран) ловит события
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

    // Zoom (Колесико)
    // Pixi не ловит wheel сам по себе, используем DOM
    document.getElementById('pixi-container').addEventListener('wheel', (e) => {
        e.preventDefault();
        const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
        
        // Зум в точку курсора (математика)
        const worldPos = mapContainer.toLocal(new PIXI.Point(e.clientX, e.clientY));
        
        mapContainer.scale.x *= scaleFactor;
        mapContainer.scale.y *= scaleFactor;
        
        // Корректируем позицию, чтобы зумить в мышку
        const newWorldPos = mapContainer.toGlobal(worldPos);
        mapContainer.x -= (newWorldPos.x - e.clientX);
        mapContainer.y -= (newWorldPos.y - e.clientY);
    });
}

// Камера к городу
window.moveCameraTo = function(q, r) {
    const pos = getHexPosition(q, r);
    // Хотим, чтобы pos в мировых координатах оказался в центре экрана
    // center = (pos * scale) + containerOffset
    // containerOffset = center - (pos * scale)
    
    mapContainer.x = (app.screen.width / 2) - (pos.x * mapContainer.scale.x);
    mapContainer.y = (app.screen.height / 2) - (pos.y * mapContainer.scale.y);
};