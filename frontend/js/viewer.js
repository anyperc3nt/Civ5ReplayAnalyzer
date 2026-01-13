// Глобальные переменные
let app; // Pixi Application
let mapContainer; // Контейнер, который мы таскаем и зумим
let terrainLayer, unitsLayer, citiesLayer; // Слои

let staticMapData = null;
let turnsData = null;

// Настройки
const HEX_RADIUS = 20;
const HEX_WIDTH = HEX_RADIUS * Math.sqrt(3);
const HEX_HEIGHT = HEX_RADIUS * 2;

// Цвета Pixi (0xRRGGBB)
const TERRAIN_COLORS = {
    0: 0x497f37, // Grass
    1: 0x888b39, // Plains
    2: 0xe4d99e, // Desert
    3: 0x858e8b, // Tundra
    4: 0xffffff, // Snow
    5: 0x3a738c, // Coast
    6: 0x1a4159, // Ocean
};

// === ИНИЦИАЛИЗАЦИЯ ===

window.initPixiApp = function(data) {
    staticMapData = data.header.staticMap;
    turnsData = data.turns;

    // 1. Создаем Pixi приложение
    const container = document.getElementById('pixi-container');
    app = new PIXI.Application({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundColor: 0x111111,
        antialias: true, // Сглаживание
        resolution: window.devicePixelRatio || 1,
    });
    container.appendChild(app.view);

    // 2. Создаем основной контейнер карты (Камера)
    mapContainer = new PIXI.Container();
    
    // Центрируем контейнер по умолчанию (чтобы (0,0) было в центре экрана)
    mapContainer.x = app.screen.width / 2;
    mapContainer.y = app.screen.height / 2;
    
    app.stage.addChild(mapContainer);

    // 3. Создаем слои
    terrainLayer = new PIXI.Container();
    unitsLayer = new PIXI.Container();
    citiesLayer = new PIXI.Container();
    
    // Порядок важен!
    mapContainer.addChild(terrainLayer);
    mapContainer.addChild(citiesLayer); // Города под юнитами? Или над?
    mapContainer.addChild(unitsLayer);

    // 4. Рисуем статический ландшафт (один раз!)
    drawStaticTerrain();

    // 5. Подключаем управление (Zoom/Pan)
    setupInteraction();

    // 6. Рисуем первый ход
    window.updatePixiTurn(0);
};

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
    // В Pixi мы рисуем графику один раз.
    // Для оптимизации 4000 гексов лучше не создавать 4000 объектов Graphics, 
    // а нарисовать их все в одном объекте (или нескольких).
    
    const graphics = new PIXI.Graphics();
    
    staticMapData.tiles.forEach((tile, index) => {
        let q = tile.x;
        let r = tile.y;
        if (q === undefined) {
            q = index % staticMapData.width;
            r = Math.floor(index / staticMapData.width);
        }

        const pos = getHexPosition(q, r);
        const color = TERRAIN_COLORS[tile.t] || 0x333333;

        // Рисуем гекс
        graphics.beginFill(color);
        graphics.lineStyle(1, 0x000000, 0.5); // Бордюр
        
        // Рисуем полигон гекса
        const path = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i + 30);
            path.push(pos.x + HEX_RADIUS * Math.cos(angle));
            path.push(pos.y + HEX_RADIUS * Math.sin(angle));
        }
        graphics.drawPolygon(path);
        graphics.endFill();
    });

    // Кэшируем как битмап для скорости (опционально, но полезно для тысяч тайлов)
    // graphics.cacheAsBitmap = true; 
    
    terrainLayer.addChild(graphics);
}

window.updatePixiTurn = function(turnIndex) {
    // Очищаем динамические слои
    unitsLayer.removeChildren();
    
    const turn = turnsData[turnIndex];
    if (!turn) return;

    // === ЮНИТЫ ===
    turn.units.forEach(unit => {
        const pos = getHexPosition(unit.x, unit.y);
        
        // Пока рисуем кружочки (потом заменим на Sprite)
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