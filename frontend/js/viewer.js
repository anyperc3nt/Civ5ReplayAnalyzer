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
    territoryLayer = new PIXI.Container();
    featuresLayer = new PIXI.Container();
    resourcesLayer = new PIXI.Container();
    mapObjectsLayer = new PIXI.Container(); 
    citiesLayer = new PIXI.Container();
    unitsLayer = new PIXI.Container();
    
    // Кто добавлен позже — тот выше (Z-index)
    mapContainer.addChild(baseTerrainLayer); // Самый низ
    mapContainer.addChild(gridLayer);        // Сетка поверх земли
    mapContainer.addChild(territoryLayer); // Границы поверх земли
    mapContainer.addChild(featuresLayer);    // Леса поверх сетки
    mapContainer.addChild(resourcesLayer); // ресурсы
    mapContainer.addChild(mapObjectsLayer); // Руины поверх ресурсов
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
    resourcesLayer.removeChildren(); 

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

        // PlotType: 0=Mountain, 1=Hills, 2=Flat
        let isMountain = tile.p === 0;
        let isHill = tile.p === 1;

        // --- 1. РИСУЕМ БАЗОВЫЙ ЛАНДШАФТ (ВСЕГДА) ---
        // Даже если это гора, она стоит на чем-то (Снег, Пустыня, Луга)
        let terrainName = globalReplayData.header.dictionary.terrains[tile.t];
        
        // Убрали блок "if (isMountain) terrainName = ...", чтобы сохранить подложку
        
        const tSprite = getSpriteFromAsset(terrainName, HEX_WIDTH * 1.05, HEX_HEIGHT * 1.05);

        if (tSprite) {
            tSprite.x = pos.x; tSprite.y = pos.y;
            
            // Маска
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
            // Фолбэк цвет (базовый)
            const g = new PIXI.Graphics();
            const color = TERRAIN_COLORS[tile.t] || 0x333333; 
            // Убрали "if (isMountain) color = 0x555555", чтобы не было серой заливки
            
            g.beginFill(color);
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

        // --- 2. НАКЛАДКА ХОЛМОВ ---
        if (isHill) {
            const hillSprite = getSpriteFromAsset("TERRAIN_HILL", HEX_WIDTH, HEX_HEIGHT);
            if (hillSprite) {
                hillSprite.x = pos.x; hillSprite.y = pos.y;
                baseTerrainLayer.addChild(hillSprite); 
            }
        }

        // --- 3. НАКЛАДКА ГОР (ТЕПЕРЬ ТАК ЖЕ, КАК ХОЛМЫ) ---
        if (isMountain) {
            // Используем имя из asset_map (TERRAIN_MOUNTAIN)
            const mtSprite = getSpriteFromAsset("TERRAIN_MOUNTAIN", HEX_WIDTH * 1.05, HEX_HEIGHT * 1.05);
            if (mtSprite) {
                mtSprite.x = pos.x; mtSprite.y = pos.y;
                baseTerrainLayer.addChild(mtSprite);
            } else {
                // Если картинки горы нет - нарисуем треугольник, чтобы не путать с равниной
                const g = new PIXI.Graphics();
                g.beginFill(0x444444); // Темно-серый пик
                g.moveTo(0, -HEX_RADIUS * 0.8);
                g.lineTo(HEX_RADIUS * 0.5, HEX_RADIUS * 0.5);
                g.lineTo(-HEX_RADIUS * 0.5, HEX_RADIUS * 0.5);
                g.endFill();
                g.x = pos.x; g.y = pos.y;
                baseTerrainLayer.addChild(g);
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
    territoryLayer.removeChildren(); // Чистим границы
    mapObjectsLayer.removeChildren(); // Чистим руины
    citiesLayer.removeChildren();

    const turn = turnsData[turnIndex];
    if (!turn) return;

    // === 1. ГРАНИЦЫ (TERRITORY) - ФИНАЛЬНЫЙ ФИКС ===
    const territoryMap = {};
    const mapW = staticMapData.width;
    const mapH = staticMapData.height;

    // 1. Заполняем карту
    turn.territory.forEach((ownerId, index) => {
        const q = index % mapW;
        const r = Math.floor(index / mapW);
        territoryMap[`${q},${r}`] = ownerId;
    });

    const graphics = new PIXI.Graphics();

    // МАССИВ СМЕЩЕНИЙ СОСЕДЕЙ (Civ 5 Odd-R)
    // Порядок важен для маппинга углов!
    // 0: East, 1: NE (Top-Right), 2: NW (Top-Left), 3: West, 4: SW (Bot-Left), 5: SE (Bot-Right)
    const getNeighbors = (isOdd) => isOdd ? [
        { dq: 1, dr: 0 },  // 0: East
        { dq: 1, dr: 1 },  // 1: Top-Right (Civ NE)
        { dq: 0, dr: 1 },  // 2: Top-Left (Civ NW)
        { dq: -1, dr: 0 }, // 3: West
        { dq: 0, dr: -1 }, // 4: Bottom-Left (Civ SW)
        { dq: 1, dr: -1 }  // 5: Bottom-Right (Civ SE)
    ] : [
        { dq: 1, dr: 0 },  // 0: East
        { dq: 0, dr: 1 },  // 1: Top-Right
        { dq: -1, dr: 1 }, // 2: Top-Left
        { dq: -1, dr: 0 }, // 3: West
        { dq: -1, dr: -1 },// 4: Bottom-Left
        { dq: 0, dr: -1 }  // 5: Bottom-Right
    ];

    // МАППИНГ: Индекс соседа -> Углы грани (в градусах)
    // 0 градусов = 3 часа (право). По часовой стрелке: 30, 90, 150...
    // Нам нужно "зеркалить" Y, поэтому Top-грани это 270-330, а Bottom 30-150.
    const EDGE_ANGLES = [
        [330, 30],  // 0: East Edge (Right)
        [270, 330], // 1: Top-Right Edge
        [210, 270], // 2: Top-Left Edge
        [150, 210], // 3: West Edge (Left)
        [90, 150],  // 4: Bottom-Left Edge
        [30, 90]    // 5: Bottom-Right Edge
    ];

    turn.territory.forEach((ownerId, index) => {
        if (ownerId === -1) return;

        const q = index % mapW;
        const r = Math.floor(index / mapW);
        const center = getHexPosition(q, r);
        const color = getPlayerColorInt(ownerId);
        
        // В Civ 5 Odd-R: нечетные (Odd) ряды сдвинуты вправо
        const isOdd = (r % 2) === 1;
        const neighborsOffsets = getNeighbors(isOdd);

        neighborsOffsets.forEach((offset, dirIndex) => {
            let nQ = q + offset.dq;
            let nR = r + offset.dr;

            // Зацикливание по X
            if (nQ < 0) nQ += mapW;
            if (nQ >= mapW) nQ -= mapW;

            // Проверка соседа
            let neighborOwner = -1;
            if (nR >= 0 && nR < mapH) {
                const key = `${nQ},${nR}`;
                if (territoryMap[key] !== undefined) {
                    neighborOwner = territoryMap[key];
                }
            }

            // РИСУЕМ ГРАНЬ, ЕСЛИ ВЛАДЕЛЬЦЫ РАЗНЫЕ
            if (neighborOwner !== ownerId) {
                const angles = EDGE_ANGLES[dirIndex];
                const a1 = (Math.PI / 180) * angles[0];
                const a2 = (Math.PI / 180) * angles[1];

                const x1 = center.x + HEX_RADIUS * Math.cos(a1);
                const y1 = center.y + HEX_RADIUS * Math.sin(a1);
                const x2 = center.x + HEX_RADIUS * Math.cos(a2);
                const y2 = center.y + HEX_RADIUS * Math.sin(a2);

                graphics.lineStyle(3, color, 0.8); // 0.8 alpha чтобы не было слишком жестко
                graphics.moveTo(x1, y1);
                graphics.lineTo(x2, y2);
            }
        });
    });

    territoryLayer.addChild(graphics);

    // === 2. ОБЪЕКТЫ КАРТЫ (РУИНЫ / ЛАГЕРЯ) ===
    if (turn.mapObjects) {
        turn.mapObjects.forEach(obj => {
            const pos = getHexPosition(obj.x, obj.y);
            
            let spriteName = null;
            if (obj.type === "RUIN") spriteName = "IMPROVEMENT_GOODY_HUT";
            if (obj.type === "CAMP") spriteName = "IMPROVEMENT_BARBARIAN_CAMP";
            
            // Пытаемся найти спрайт, иначе рисуем кружок
            const sprite = getSpriteFromAsset(spriteName, HEX_WIDTH * 0.7, HEX_WIDTH * 0.7);
            
            if (sprite) {
                sprite.x = pos.x; sprite.y = pos.y;
                mapObjectsLayer.addChild(sprite);
            } else {
                // Фолбэк графика
                const g = new PIXI.Graphics();
                g.beginFill(obj.type === "RUIN" ? 0xFFD700 : 0xFF0000); // Золотой или Красный
                g.drawCircle(0, 0, 10);
                g.endFill();
                g.x = pos.x; g.y = pos.y;
                mapObjectsLayer.addChild(g);
            }
        });
    }

    // === 3. ГОРОДА (Обновленная логика) ===
    turn.cities.forEach(city => {
        const pos = getHexPosition(city.x, city.y);
        
        const g = new PIXI.Container();
        g.x = pos.x; g.y = pos.y;
        
        // Квадратик города
        const box = new PIXI.Graphics();
        const color = getPlayerColorInt(city.owner);
        box.beginFill(0x333333); 
        box.lineStyle(2, color); // Цвет границы = цвет владельца
        box.drawRect(-12, -12, 24, 24);
        box.endFill();
        
        // Полоска здоровья города
        if (city.hp < 200) { // Обычно 200 это макс
             const hpPct = Math.max(0, city.hp / 200);
             box.beginFill(0x00FF00);
             box.drawRect(-12, -15, 24 * hpPct, 3); // Полоска сверху
             box.endFill();
        }

        // Текст (Название + Население)
        const nameText = new PIXI.Text(city.name, {
            fontFamily: 'Arial', 
            fontSize: 14, // Попробуй уменьшить
            fill: 0xffffff,
            stroke: 0x000000, 
            strokeThickness: 3,
            fontWeight: 'bold',
            lineJoin: 'round' // Сглаживает углы обводки
        });
        nameText.resolution = 2; // <--- ВАЖНО: Увеличиваем разрешение текстуры текста
        nameText.scale.set(0.5); // И сжимаем обратно, чтобы он был четким, но маленьким
        nameText.anchor.set(0.5, 1.6); // Над квадратом

        // Иконка производства (если есть данные)
        if (city.prodItem) {
             const prodText = new PIXI.Text(`🛠 ${city.prodTurns}`, {
                 fontFamily: 'Arial', fontSize: 10, fill: 0xcccccc
             });
             prodText.anchor.set(0.5, -1.2); // Под квадратом
             g.addChild(prodText);
        }

        g.addChild(box);
        g.addChild(nameText);
        
        // Интерактивность для клика
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.on('pointerdown', () => {
            // Вызываем Vue метод (через глобальное событие или dispatch)
            // Но проще всего, если Vue компонент сам следит за window.selectedCity
            if (window.appVue) {
                window.appVue.selectCity(city);
            }
        });

        citiesLayer.addChild(g);
    });

    // === 4. ЮНИТЫ (Обновленная логика цветов) ===
    turn.units.forEach(unit => {
        const pos = getHexPosition(unit.x, unit.y);
        // ... (код юнитов остается похожим, только цвет берем через функцию) ...
        // Используй getPlayerColorInt(unit.owner) для кружка
        
        // ...
        
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
            const color = getPlayerColorInt(unit.owner);
            circle.beginFill(color);
            circle.drawCircle(0, 0, HEX_RADIUS * 0.5);
            circle.x = pos.x;
            circle.y = pos.y;
            
            unitsLayer.addChild(circle); // Сначала кружок команды
            unitsLayer.addChild(sprite); // Сверху иконка
        } else {
            // ... старый код с цветными кружками ...
            const g = new PIXI.Graphics();
            const color = getPlayerColorInt(unit.owner);
    
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
}

// Палитра стандартных цветов Цивилизации
const PLAYER_PALETTE = [
    0xda2020, // 0: Красный (Австрия/Япония и тд) - условно
    0x3366cc, // 1: Синий
    0xffcc00, // 2: Желтый
    0x00aa00, // 3: Зеленый
    0xcc6600, // 4: Оранжевый
    0x990099, // 5: Фиолетовый
    0x009999, // 6: Циан
    0xffffff, // 7: Белый
    0x888888, // 8: Серый
];

function getPlayerColorInt(playerId) {
    // 63 - это обычно Варвары в Civ 5
    if (playerId === 63) return 0x222222; // Темно-серый/Черный
    
    // ГГ обычно имеют высокие ID (22+)
    if (playerId >= 22 && playerId < 63) {
        // Генерируем оттенок серого/темного
        return 0x444444; 
    }
    
    return PLAYER_PALETTE[playerId % PLAYER_PALETTE.length] || 0xffffff;
}