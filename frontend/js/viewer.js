/* 
    viewer.js - Логика отрисовки карты на HTML5 Canvas
    Работает в паре с Vue.js из index.html
*/

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');

// --- НАСТРОЙКИ ---
const HEX_SIZE = 20; // Базовый радиус гекса

// Цвета тайлов (Terrain ID -> Color)
const TERRAIN_COLORS = {
    0: "#497f37", // Grass (Трава)
    1: "#888b39", // Plains (Равнины)
    2: "#e4d99e", // Desert (Пустыня)
    3: "#858e8b", // Tundra (Тундра)
    4: "#ffffff", // Snow (Снег)
    5: "#3a738c", // Coast (Побережье)
    6: "#1a4159", // Ocean (Океан)
    "unknown": "#ff00ff"
};

// --- СОСТОЯНИЕ ---
let camera = { x: 0, y: 0, zoom: 1 };
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

let staticMap = null;
let currentTurnIndex = 0;
let replayData = null; // Ссылка на полные данные

// --- API ДЛЯ VUE.JS ---

/**
 * Инициализация карты. Вызывается из Vue после загрузки данных.
 * @param {Object} data - Объект REPLAY_DATA
 */
window.initMap = function(data) {
    console.log("Map initialized via Vue");
    replayData = data;
    staticMap = data.header.staticMap;

    // 1. Центрирование камеры
    if (staticMap) {
        // Вычисляем примерный центр карты в пикселях
        // Ширина мира = кол-во колонок * ширина гекса
        const worldWidth = staticMap.width * HEX_SIZE * Math.sqrt(3);
        const worldHeight = staticMap.height * HEX_SIZE * 1.5;
        
        // Смещаем камеру так, чтобы (0,0) экрана совпало с центром карты
        // camera.x смещает мир. Если camera.x = -100, мир сдвигается влево.
        camera.x = -(worldWidth / 2);
        
        // Y у нас инвертирован (0 внизу), поэтому "верх" экрана в Canvas (y=0) 
        // должен соответствовать "верху" карты (max Y).
        // Но пока просто отцентруем по середине высоты
        camera.y = -(worldHeight / 2); 
    }

    // 2. Слушатели событий мыши (Drag & Zoom)
    setupInputHandlers();

    // 3. Первая отрисовка
    resize();
    window.setMapTurn(0);
};

/**
 * Установка текущего хода. Вызывается из Vue при движении слайдера.
 * @param {Number} index - Индекс хода в массиве turns
 */
window.setMapTurn = function(index) {
    currentTurnIndex = index;
    // Запрашиваем перерисовку в следующем кадре (оптимизация)
    window.requestAnimationFrame(draw);
};

/**
 * Перемещение камеры к гексу (q, r). Вызывается при клике на город.
 */
window.moveCameraTo = function(q, r) {
    if (!staticMap) return;
    
    // Нам нужно найти такие camera.x/y, чтобы hexToPixel(q, r) вернул (0,0) 
    // (относительно центра экрана)
    
    // 1. Считаем позицию гекса в мире БЕЗ камеры
    const size = HEX_SIZE; // Zoom пока считаем 1 для простоты расчета смещения, или учитываем zoom
    // Но камера хранит смещение в "мировых" координатах или экранных? 
    // В моей реализации hexToPixel: x = worldX * zoom + camX + center
    
    // Давайте сделаем просто: сбросим камеру в предполагаемую точку
    // Это сложнее из-за инверсии Y и зума. 
    // Пока оставим заглушку, чтобы не сломать логику перевернутой карты
    console.log(`Moving camera to City at [${q}, ${r}]`);
};

// --- ВНУТРЕННЯЯ ЛОГИКА ---

function setupInputHandlers() {
    canvas.addEventListener('mousedown', e => { 
        isDragging = true; 
        lastMouse = {x: e.clientX, y: e.clientY}; 
    });
    
    canvas.addEventListener('mousemove', e => {
        if (isDragging) {
            // Сдвиг камеры
            camera.x += e.clientX - lastMouse.x;
            camera.y += e.clientY - lastMouse.y;
            lastMouse = {x: e.clientX, y: e.clientY};
            window.requestAnimationFrame(draw);
        }
    });
    
    canvas.addEventListener('mouseup', () => isDragging = false);
    
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const scale = e.deltaY > 0 ? 0.9 : 1.1;
        camera.zoom *= scale;
        window.requestAnimationFrame(draw);
    });

    window.addEventListener('resize', resize);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw(); // Перерисовка при ресайзе
}

/**
 * Конвертация координат гекса (Civ5 Offset) в пиксели экрана
 */
function hexToPixel(q, r) {
    const size = HEX_SIZE * camera.zoom;
    const w = size * Math.sqrt(3); 
    
    // === ВАЖНЫЙ ФИКС ВЕРТИКАЛИ ===
    // В Civ 5 Y=0 внизу. В Canvas Y=0 вверху.
    // Инвертируем Y относительно высоты карты
    const invertedR = staticMap.height - 1 - r; 
    
    // Формула для "Pointy Top" гексов (Odd-R offset)
    // Смещение по X для нечетных рядов
    // Внимание: если мы инвертировали R, проверка четности (invertedR % 2) 
    // должна соответствовать логике игры. 
    // Обычно в Civ5 смещение зависит от реального Y (r).
    // Попробуем использовать оригинальный r для смещения, но invertedR для позиции.
    
    const x = (q + (r % 2) * 0.5) * w;
    const y = invertedR * (size * 1.5);
    
    // Применяем камеру и центр экрана
    return { 
        x: x + camera.x + canvas.width/2, 
        y: y + camera.y + canvas.height/2 
    };
}

function drawHex(ctx, x, y, color, text) {
    const size = HEX_SIZE * camera.zoom;
    
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        // Угол 60*i + 30 для Pointy Top
        const angle = (Math.PI / 180) * (60 * i + 30); 
        const px = x + size * Math.cos(angle);
        const py = y + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    
    ctx.fillStyle = color;
    ctx.fill();
    
    // Обводка (слишком толстая мешает на большом зуме)
    if (camera.zoom > 0.5) {
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Текст (координаты) - для отладки
    if (text && camera.zoom > 1.5) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.font = `${8 * camera.zoom}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x, y);
    }
}

function draw() {
    // 1. Очистка (Темный фон)
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!staticMap || !replayData) return;

    // 2. Рисуем ЛАНДШАФТ
    // (В будущем здесь можно оптимизировать, рисуя только видимую область)
    staticMap.tiles.forEach((tile, index) => {
        // Восстанавливаем координаты, если их нет
        let x = tile.x;
        let y = tile.y;
        if (x === undefined) {
            x = index % staticMap.width;
            y = Math.floor(index / staticMap.width);
        }

        const pos = hexToPixel(x, y);
        
        // Culling (отсечение невидимого) - увеличивает FPS
        const margin = HEX_SIZE * camera.zoom * 2;
        if (pos.x < -margin || pos.x > canvas.width + margin || 
            pos.y < -margin || pos.y > canvas.height + margin) return;

        const color = TERRAIN_COLORS[tile.t] || "#333";
        drawHex(ctx, pos.x, pos.y, color);
    });

    // 3. Рисуем ЮНИТЫ (Динамика)
    const turnData = replayData.turns[currentTurnIndex];
    if (turnData && turnData.units) {
        turnData.units.forEach(unit => {
            const pos = hexToPixel(unit.x, unit.y);
            
            // Если юнит за экраном - не рисуем
            if (pos.x < 0 || pos.x > canvas.width || pos.y < 0 || pos.y > canvas.height) return;

            // Рисуем кружок
            const radius = HEX_SIZE * 0.6 * camera.zoom;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
            
            // Цвета игроков (простой массив)
            const playerColors = ["#f00", "#00f", "#0f0", "#ff0", "#0ff", "#f0f", "#fff", "#888"];
            ctx.fillStyle = playerColors[unit.owner % playerColors.length] || "white";
            
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#000";
            ctx.stroke();
        });
    }

    // 4. Рисуем ГОРОДА (Динамика)
    if (turnData && turnData.cities) {
        turnData.cities.forEach(city => {
            const pos = hexToPixel(city.x, city.y);
            
            // Квадратик для города
            const size = HEX_SIZE * 0.8 * camera.zoom;
            ctx.fillStyle = "white"; // Можно сделать цвет игрока
            ctx.fillRect(pos.x - size/2, pos.y - size/2, size, size);
            
            // Имя города
            if (camera.zoom > 0.8) {
                ctx.fillStyle = "white";
                ctx.font = `bold ${10 * camera.zoom}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textShadow = "1px 1px 2px black";
                ctx.fillText(city.name, pos.x, pos.y - size);
            }
        });
    }
}