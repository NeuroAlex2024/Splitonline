// ===============================
// ЛАБИРИНТ ПОГОНИ - GAME ENGINE
// ОНЛАЙН ВЕРСИЯ 3.0 с Socket.IO
// ===============================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');

// 🌐 МУЛЬТИПЛЕЕР СИСТЕМА
let socket = null;
let isOnlineMode = false;
let onlineGameState = {
    roomCode: null,
    playerId: null,
    playerRole: null, // 'host' или 'guest'
    gameRole: null,   // 'hunter' или 'prey'
    myCharacter: null,
    opponentCharacter: null,
    isConnected: false,
    opponentPosition: { x: 0, y: 0, angle: 0 },
    lastSentPosition: { x: 0, y: 0, angle: 0 },
    inputBuffer: []
};

// Инициализация Socket.IO
function initSocket() {
    if (socket) return;
    
    socket = io();
    
    socket.on('connect', () => {
        console.log('🌐 Подключено к серверу');
        onlineGameState.isConnected = true;
        updateConnectionStatus('connected', 'Подключено к серверу');
    });
    
    socket.on('disconnect', () => {
        console.log('🌐 Отключено от сервера');
        onlineGameState.isConnected = false;
        updateConnectionStatus('error', 'Соединение потеряно');
    });
    
    // События комнат
    socket.on('room-created', (data) => {
        onlineGameState.roomCode = data.roomCode;
        onlineGameState.playerRole = data.role;
        showLobby();
        updateRoomCode(data.roomCode);
    });
    
    socket.on('room-joined', (data) => {
        onlineGameState.roomCode = data.roomCode;
        onlineGameState.playerRole = data.role;
        showLobby();
        updateRoomCode(data.roomCode);
    });
    
    socket.on('player-joined', (data) => {
        updatePlayersInLobby(data.players);
    });
    
    socket.on('character-selected', (data) => {
        updatePlayersInLobby(data.players);
    });
    
    socket.on('game-start', (data) => {
        // Определяем нашу роль в игре
        const myPlayer = data.players.find(p => p.socketId === socket.id);
        const opponent = data.players.find(p => p.socketId !== socket.id);
        
        onlineGameState.gameRole = myPlayer.gameRole;
        onlineGameState.myCharacter = myPlayer.character;
        onlineGameState.opponentCharacter = opponent.character;
        
        // Настраиваем игру для мультиплеера
        isOnlineMode = true;
        characterSelection.hunter = onlineGameState.gameRole === 'hunter' ? onlineGameState.myCharacter : onlineGameState.opponentCharacter;
        characterSelection.prey = onlineGameState.gameRole === 'prey' ? onlineGameState.myCharacter : onlineGameState.opponentCharacter;
        
        startOnlineGame();
    });
    
    socket.on('opponent-input', (data) => {
        // Применяем ввод противника к его персонажу
        if (onlineGameState.gameRole === 'hunter' && preyPlayer) {
            updatePlayerFromInput(preyPlayer, data.controls, onlineGameState.opponentCharacter);
        } else if (onlineGameState.gameRole === 'prey' && hunterPlayer) {
            updatePlayerFromInput(hunterPlayer, data.controls, onlineGameState.opponentCharacter);
        }
    });
    
    socket.on('opponent-position', (data) => {
        onlineGameState.opponentPosition = {
            x: data.x,
            y: data.y,
            angle: data.angle,
            timestamp: data.timestamp
        };
    });
    
    socket.on('booster-sync-collected', (data) => {
        // Синхронизируем сбор бустера
        for (let i = 0; i < boosters.length; i++) {
            if (boosters[i].id === data.boosterId) {
                boosters[i].collected = true;
                break;
            }
        }
    });
    
    socket.on('game-ended', (data) => {
        endGame(data.winner);
        // Обновляем счет
        gameState.scores = data.scores;
    });
    
    socket.on('next-round', (data) => {
        gameState.roundNumber = data.roundNumber;
        gameState.scores = data.scores;
        nextRound();
    });
    
    socket.on('series-ended', (data) => {
        // Показываем финальные результаты
        setTimeout(() => {
            alert(`Серия завершена! Победитель: ${data.finalWinner === 'hunter' ? 'Охотник' : 'Добыча'}`);
        }, 1000);
    });
    
    socket.on('player-disconnected', (data) => {
        alert('Противник отключился');
        leaveLobby();
    });
    
    socket.on('error', (data) => {
        alert('Ошибка: ' + data.message);
        updateConnectionStatus('error', data.message);
    });
}

// 🎮 СИСТЕМА НАСТРОЕК ГРАФИКИ
const GRAPHICS_PRESETS = {
    LOW: {
        targetFPS: 30,
        maxParticles: 15,
        particleUpdateInterval: 4,
        backgroundRedrawInterval: 8,
        trailLength: 5,
        shadows: false,
        effects: false,
        interpolation: false,
        resolutionScale: 0.33  // 33% разрешения (было 50%)
    },
    MED: {
        targetFPS: 60,
        maxParticles: 50,
        particleUpdateInterval: 2,
        backgroundRedrawInterval: 3,
        trailLength: 10,
        shadows: true,
        effects: true,
        interpolation: true,
        resolutionScale: 0.5  // 50% разрешения (было 75%)
    },
    HIGH: {
        targetFPS: 120,
        maxParticles: 100,
        particleUpdateInterval: 1,
        backgroundRedrawInterval: 1,
        trailLength: 20,
        shadows: true,
        effects: true,
        interpolation: true,
        resolutionScale: 1.0  // 100% разрешения
    }
};

// Игровые константы (с оптимизациями)
const GAME_CONFIG = {
    worldWidth: 2340,
    worldHeight: 1175,
    baseCanvasWidth: 1680,  // Базовое разрешение
    baseCanvasHeight: 900,
    canvasWidth: 1680,      // Текущее разрешение (будет изменяться)
    canvasHeight: 900,
    cellSize: 50,
    catchDistance: 45,
    roundTime: 120,
    boosterLifetime: 15000,
    boosterSpawnRate: 0.008,
    totalRounds: 5,
    lastBoosterSpawnTime: 0,
    minBoosterInterval: 4000,
    maxBoosterInterval: 6000,
    targetBoosterCount: 6,
    initialBoosterDelay: 2000,
    
    // 🚀 ОПТИМИЗАЦИИ ПРОИЗВОДИТЕЛЬНОСТИ (будут обновляться из пресетов)
    targetFPS: 60,
    maxParticles: 50,
    particleUpdateInterval: 2,
    renderSkipFrames: 0,
    backgroundRedrawInterval: 3,
    
    // 🎮 ПЕРЕКЛЮЧАТЕЛЬ УПРАВЛЕНИЯ
    controlsSwapped: false,
    
    // 🎨 НАСТРОЙКИ ГРАФИКИ
    graphicsLevel: 'MED',
    autoAdapt: true
};

// 🎯 Состояние переключателя управления (объединяем с GAME_CONFIG)
// let controlState = {
//     swapped: false,
//     hunterColor: '#ff4757', // Красный для охотника
//     preyColor: '#3742fa',   // Синий для добычи
// };

// Состояние игры
let gameState = {
    mode: 'start', // start, playing, ended
    startTime: 0,
    roundNumber: 1,
    winner: null,
    gameTime: 0,
    scores: { // Добавляем счет
        hunter: 0,
        prey: 0
    }
};

// Выбор персонажей
let characterSelection = {
    hunter: null, // 'punk' или 'businessman'
    prey: null    // 'punk' или 'businessman'
};

// Конфигурация игроков для текущей игры
let playerConfig = null;

// Динамические игроки (создаются в зависимости от выбора)
let hunterPlayer = null;
let preyPlayer = null;

// Игроки
const players = {
    punk: {
        x: 100,
        y: 100,
        width: 35,
        height: 45,
        originalWidth: 35,
        originalHeight: 45,
        speed: 0,
        maxSpeed: 7,
        baseMaxSpeed: 7, // Сохраняем базовую скорость
        acceleration: 0.6,
        baseAcceleration: 0.6, // Сохраняем базовое ускорение
        angle: 0,
        boosts: new Map(),
        trail: [],
        isGhost: false,
        ghostCooldown: 0,
        actionPressed: false,
        lastSafeX: 100,
        lastSafeY: 100,
        // Свойства для анимации гиганта
        giantScale: 1,
        giantAnimationTime: 0,
        isGiant: false,
        lastWallBreakTime: 0
    },
    businessman: {
        x: GAME_CONFIG.worldWidth - 150,
        y: GAME_CONFIG.worldHeight - 150,
        width: 30,
        height: 40,
        originalWidth: 30,
        originalHeight: 40,
        speed: 0,
        maxSpeed: 7,
        baseMaxSpeed: 7,
        acceleration: 0.5,
        baseAcceleration: 0.5,
        angle: 0,
        boosts: new Map(),
        trail: [],
        isGhost: false,
        ghostCooldown: 0,
        actionPressed: false,
        lastSafeX: GAME_CONFIG.worldWidth - 150,
        lastSafeY: GAME_CONFIG.worldHeight - 150,
        // Свойства для анимации гиганта
        giantScale: 1,
        giantAnimationTime: 0,
        isGiant: false,
        lastWallBreakTime: 0
    },
    kok: {
        x: 100,
        y: 100,
        width: 32,
        height: 42,
        originalWidth: 32,
        originalHeight: 42,
        speed: 0,
        maxSpeed: 7,
        baseMaxSpeed: 7,
        acceleration: 0.55,
        baseAcceleration: 0.55,
        angle: 0,
        boosts: new Map(),
        trail: [],
        isGhost: false,
        ghostCooldown: 0,
        actionPressed: false,
        lastSafeX: 100,
        lastSafeY: 100,
        // Свойства для анимации гиганта
        giantScale: 1,
        giantAnimationTime: 0,
        isGiant: false,
        lastWallBreakTime: 0
    },
    maks: {
        x: 100,
        y: 100,
        width: 38, // На 20% шире чем у Степы (32 * 1.2 = 38.4, округляем до 38)
        height: 42,
        originalWidth: 38,
        originalHeight: 42,
        speed: 0,
        maxSpeed: 7,
        baseMaxSpeed: 7,
        acceleration: 0.55,
        baseAcceleration: 0.55,
        angle: 0,
        boosts: new Map(),
        trail: [],
        isGhost: false,
        ghostCooldown: 0,
        actionPressed: false,
        lastSafeX: 100,
        lastSafeY: 100,
        // Свойства для анимации гиганта
        giantScale: 1,
        giantAnimationTime: 0,
        isGiant: false,
        lastWallBreakTime: 0
    }
};

// Управление
const keys = {};
const controls = {
    punk: {
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        action: 'Slash'
    },
    businessman: {
        up: 'KeyW',
        down: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        action: 'KeyE'
    },
    kok: {
        up: 'KeyW',
        down: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        action: 'KeyE'
    },
    maks: {
        up: 'KeyW',
        down: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        action: 'KeyE'
    }
};

// Лабиринт и объекты
let maze = [];
let boosters = [];
let particles = [];
let walls = [];

// Типы бустеров
const BOOSTER_TYPES = {
    speed: {
        color: '#00ff88',
        glowColor: 'rgba(0, 255, 136, 0.8)',
        symbol: '⚡',
        name: 'Скорость',
        duration: 5000
    },
    ghost: {
        color: '#9c88ff',
        glowColor: 'rgba(156, 136, 255, 0.8)',
        symbol: '👻',
        name: 'Призрак',
        duration: 4000
    },
    teleport: {
        color: '#ff6b35',
        glowColor: 'rgba(255, 107, 53, 0.8)',
        symbol: '🎯',
        name: 'Телепорт',
        duration: 0, // Мгновенный эффект
        distance: 450 // Увеличено с 300 до 450 (на 50% дальше)
    },
    giant: {
        color: '#ffd700',
        glowColor: 'rgba(255, 215, 0, 0.8)',
        symbol: '🦾',
        name: 'Гигант',
        duration: 3000
    }
};

// ===============================
// СОБЫТИЯ И МУЗЫКА
// ===============================

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    e.preventDefault();
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    e.preventDefault();
});

// Обработчик полноэкранного режима
document.addEventListener('keydown', (e) => {
    if (e.code === 'F11') {
        e.preventDefault();
        toggleFullscreen();
    }
});

// Управление полноэкранным режимом
function toggleFullscreen() {
    const gameContainer = document.querySelector('.game-container');
    
    if (!document.fullscreenElement) {
        gameContainer.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

// Обработчик изменения размера окна
function handleResize() {
    // Задержка для избежания многократных вызовов
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        initializeCanvas();
        // Перегенерируем лабиринт если игра не активна
        if (gameState.mode !== 'playing') {
            generateMaze();
        }
    }, 100);
}

// Инициализация при загрузке
window.addEventListener('load', () => {
    initializeCanvas();
    generateMaze();
});

// Обработчик изменения размера окна
window.addEventListener('resize', handleResize);

// Обработчик изменения ориентации для мобильных устройств  
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        handleResize();
    }, 100);
});

// ===============================
// ДИНАМИЧЕСКАЯ МУЗЫКАЛЬНАЯ СИСТЕМА
// ===============================

// Новая функция для управления музыкой
function playMusic(type) {
    const music = document.getElementById('backgroundMusic');
    switch(type) {
        case 'chase': music.src = 'assets/music/chase.mp3'; break;
        case 'stealth': music.src = 'assets/music/stealth.mp3'; break;
        case 'victory': music.src = 'assets/music/victory.mp3'; break;
        case 'defeat': music.src = 'assets/music/defeat.mp3'; break;
    }
    music.play();
}

// Обновляем функцию playBackgroundMusic
function playBackgroundMusic() {
    playMusic('chase'); // Запускаем chase.mp3 по умолчанию
}

// ===============================
// ГЕНЕРАЦИЯ ЛАБИРИНТА
// ===============================

function generateMaze() {
    const cols = Math.floor(GAME_CONFIG.worldWidth / GAME_CONFIG.cellSize);
    const rows = Math.floor(GAME_CONFIG.worldHeight / GAME_CONFIG.cellSize);
    
    // Инициализация сетки
    maze = Array(rows).fill().map(() => Array(cols).fill(1));
    walls = [];
    
    // Алгоритм рекурсивного обхода для создания лабиринта
    function carvePassages(x, y) {
        maze[y][x] = 0;
        
        const directions = [
            [0, -2], [2, 0], [0, 2], [-2, 0]
        ].sort(() => Math.random() - 0.5);
        
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && maze[ny][nx] === 1) {
                maze[y + dy/2][x + dx/2] = 0;
                carvePassages(nx, ny);
            }
        }
    }
    
    // Начинаем с верхнего левого угла
    carvePassages(1, 1);
    
    // Убеждаемся что стартовые позиции свободны
    maze[1][1] = 0;
    maze[1][2] = 0;
    maze[2][1] = 0;
    
    const endX = cols - 2;
    const endY = rows - 2;
    maze[endY][endX] = 0;
    maze[endY-1][endX] = 0;
    maze[endY][endX-1] = 0;
    
    // Создаем дополнительные проходы для более интересного геймплея
    for (let i = 0; i < Math.floor(rows * cols * 0.08); i++) {
        const x = Math.floor(Math.random() * cols);
        const y = Math.floor(Math.random() * rows);
        if (maze[y] && maze[y][x] !== undefined) {
            maze[y][x] = 0;
        }
    }
    
    // Конвертируем в стены для коллизий
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (maze[y][x] === 1) {
                walls.push({
                    x: x * GAME_CONFIG.cellSize,
                    y: y * GAME_CONFIG.cellSize,
                    width: GAME_CONFIG.cellSize,
                    height: GAME_CONFIG.cellSize
                });
            }
        }
    }
}

// ===============================
// ЧАСТИЦЫ И ЭФФЕКТЫ
// ===============================

// 🚀 ОПТИМИЗАЦИЯ: Пул объектов для частиц
const particlePool = [];
const maxPoolSize = 100;

class OptimizedParticle {
    constructor(x, y, color, velocity, life, size = 3) {
        this.reset(x, y, color, velocity, life, size);
    }
    
    reset(x, y, color, velocity, life, size = 3) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.velocity = velocity;
        this.life = life;
        this.maxLife = life;
        this.size = size;
        this.gravity = Math.random() * 0.5;
        this.active = true;
    }

    update(deltaTime) {
        if (!this.active) return false;
        
        this.x += this.velocity.x * deltaTime / 16.67;
        this.y += this.velocity.y * deltaTime / 16.67;
        this.velocity.y += this.gravity;
        this.life -= deltaTime;
        this.size *= 0.99;
        
        if (this.life <= 0) {
            this.active = false;
            return false;
        }
        return true;
    }

    draw(ctx, offsetX, offsetY) {
        if (!this.active) return;
        
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x - offsetX, this.y - offsetY, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Инициализация пула частиц
for (let i = 0; i < maxPoolSize; i++) {
    particlePool.push(new OptimizedParticle(0, 0, '#ffffff', {x: 0, y: 0}, 0));
}

// 🚀 ОПТИМИЗИРОВАННАЯ функция создания частиц
function createOptimizedParticles(x, y, color, count = 10) {
    const currentActiveCount = particles.filter(p => p.active).length;
    if (currentActiveCount >= GAME_CONFIG.maxParticles) return;
    
    const maxNewParticles = Math.min(count, GAME_CONFIG.maxParticles - currentActiveCount);
    
    for (let i = 0; i < maxNewParticles; i++) {
        let particle = particlePool.find(p => !p.active);
        if (!particle) {
            particle = new OptimizedParticle(0, 0, '#ffffff', {x: 0, y: 0}, 0);
            particlePool.push(particle);
        }
        
        const angle = (Math.PI * 2 * i) / maxNewParticles + Math.random() * 0.5;
        const speed = Math.random() * 150 + 50;
        const velocity = {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
        };
        
        particle.reset(x, y, color, velocity, 1500, Math.random() * 4 + 1);
        particles.push(particle);
    }
}

// ===============================
// КОЛЛИЗИИ
// ===============================

function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function checkWallCollision(player, newX, newY) {
    if (player.isGhost) return false;
    
    // Проверка границ мира с дополнительным отступом
    const borderMargin = 10;
    if (newX < borderMargin || 
        newY < borderMargin || 
        newX + player.width > GAME_CONFIG.worldWidth - borderMargin || 
        newY + player.height > GAME_CONFIG.worldHeight - borderMargin) {
        return true;
    }
    
    const testRect = {
        x: newX + 5, // Увеличенный отступ
        y: newY + 5,
        width: player.width - 10,
        height: player.height - 10
    };
    
    return walls.some(wall => checkCollision(testRect, wall));
}

function getDistanceBetweenPlayers() {
    if (!hunterPlayer || !preyPlayer) return 1000;
    
    const dx = hunterPlayer.x - preyPlayer.x;
    const dy = hunterPlayer.y - preyPlayer.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ===============================
// БУСТЕРЫ
// ===============================

function spawnBooster() {
    const cols = Math.floor(GAME_CONFIG.worldWidth / GAME_CONFIG.cellSize);
    const rows = Math.floor(GAME_CONFIG.worldHeight / GAME_CONFIG.cellSize);
    
    let attempts = 0;
    let x, y;
    
    do {
        const col = Math.floor(Math.random() * cols);
        const row = Math.floor(Math.random() * rows);
        x = col * GAME_CONFIG.cellSize + GAME_CONFIG.cellSize / 2 - 15;
        y = row * GAME_CONFIG.cellSize + GAME_CONFIG.cellSize / 2 - 15;
        attempts++;
    } while (
        // Проверяем что позиция не в стене
        (maze[Math.floor(y / GAME_CONFIG.cellSize)] && 
         maze[Math.floor(y / GAME_CONFIG.cellSize)][Math.floor(x / GAME_CONFIG.cellSize)] === 1) ||
        // Проверяем что позиция не за границей игровой зоны (оставляем отступ 100px от границы)
        y > GAME_CONFIG.worldHeight - 150 ||
        attempts < 50
    );
    
    const types = Object.keys(BOOSTER_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    
    boosters.push({
        x: x,
        y: y,
        width: 30,
        height: 30,
        type: type,
        collected: false,
        rotation: 0,
        pulse: 0,
        lifetime: GAME_CONFIG.boosterLifetime,
        opacity: 1,
        id: `booster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` // Уникальный ID для мультиплеера
    });
}

function updateBoosters(deltaTime) {
    boosters = boosters.filter(booster => {
        if (booster.collected) return false;
        
        booster.lifetime -= deltaTime;
        booster.rotation += 0.05;
        booster.pulse += 0.1;
        
        // Эффект исчезновения
        if (booster.lifetime < 3000) {
            booster.opacity = booster.lifetime / 3000;
        }
        
        return booster.lifetime > 0;
    });
}

function checkBoosterCollisions(player) {
    boosters.forEach(booster => {
        if (!booster.collected && checkCollision(player, booster)) {
            booster.collected = true;
            
            // 🌐 МУЛЬТИПЛЕЕР: Уведомляем о сборе бустера
            if (isOnlineMode && booster.id) {
                sendBoosterCollected(booster.id);
            }
            
            const boosterType = BOOSTER_TYPES[booster.type];
            
            // Создаем частицы
            createOptimizedParticles(
                booster.x + booster.width / 2,
                booster.y + booster.height / 2,
                boosterType.color,
                20
            );
            
            // Специальная обработка для телепорта
            if (booster.type === 'teleport') {
                // Телепорт применяется мгновенно
                teleportPlayer(player);
            } else if (booster.type === 'giant') {
                // Гигант применяется с эффектом разрушения стен
                player.boosts.set(booster.type, {
                    duration: boosterType.duration,
                    startTime: Date.now()
                });
                
                // Создаем эффект активации гиганта
                createOptimizedParticles(
                    player.x + player.width / 2,
                    player.y + player.height / 2,
                    BOOSTER_TYPES.giant.color,
                    30
                );
            } else {
                // Для остальных бустеров применяем эффект
                player.boosts.set(booster.type, {
                    duration: boosterType.duration,
                    startTime: Date.now()
                });
            }
        }
    });
}

// ===============================
// ТЕЛЕПОРТАЦИЯ
// ===============================

function teleportPlayer(player) {
    // Всегда телепортируем в направлении, куда смотрит персонаж
    const teleportDirection = {
        x: Math.cos(player.angle),
        y: Math.sin(player.angle)
    };
    
    const teleportDistance = BOOSTER_TYPES.teleport.distance;
    const targetX = player.x + teleportDirection.x * teleportDistance;
    const targetY = player.y + teleportDirection.y * teleportDistance;
    
    // Проверяем, что целевая позиция находится в пределах мира
    const clampedX = Math.max(0, Math.min(GAME_CONFIG.worldWidth - player.width, targetX));
    const clampedY = Math.max(0, Math.min(GAME_CONFIG.worldHeight - player.height, targetY));
    
    // Проверяем коллизии со стенами
    if (!checkWallCollision(player, clampedX, clampedY)) {
        // Создаем эффект исчезновения в исходной позиции
        createOptimizedParticles(
            player.x + player.width / 2,
            player.y + player.height / 2,
            BOOSTER_TYPES.teleport.color,
            30
        );
        
        // Телепортируем игрока
        player.x = clampedX;
        player.y = clampedY;
        player.lastSafeX = clampedX;
        player.lastSafeY = clampedY;
        
        // Создаем эффект появления в новой позиции
        createOptimizedParticles(
            player.x + player.width / 2,
            player.y + player.height / 2,
            BOOSTER_TYPES.teleport.color,
            30
        );
        
        return true; // Успешная телепортация
    } else {
        // Если целевая позиция заблокирована, ищем ближайшую свободную позицию
        const directions = [];
        const steps = 24; // Увеличиваем количество направлений для лучшего поиска
        
        // Создаем спиральный паттерн поиска с разными дистанциями
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            // Используем разные дистанции: от 60% до 120% от базовой дистанции
            const distanceMultiplier = 0.6 + (i / steps) * 0.6;
            const distance = teleportDistance * distanceMultiplier;
            directions.push({
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance
            });
        }
        
        // Сортируем направления по расстоянию от текущей позиции (ближайшие сначала)
        directions.sort((a, b) => {
            const distA = Math.hypot(a.x, a.y);
            const distB = Math.hypot(b.x, b.y);
            return distA - distB;
        });
        
        // Ищем безопасную позицию
        for (const dir of directions) {
            const testX = player.x + dir.x;
            const testY = player.y + dir.y;
            const clampedTestX = Math.max(0, Math.min(GAME_CONFIG.worldWidth - player.width, testX));
            const clampedTestY = Math.max(0, Math.min(GAME_CONFIG.worldHeight - player.height, testY));
            
            if (!checkWallCollision(player, clampedTestX, clampedTestY)) {
                // Создаем эффект исчезновения
                createOptimizedParticles(
                    player.x + player.width / 2,
                    player.y + player.height / 2,
                    BOOSTER_TYPES.teleport.color,
                    30
                );
                
                // Телепортируем игрока
                player.x = clampedTestX;
                player.y = clampedTestY;
                player.lastSafeX = clampedTestX;
                player.lastSafeY = clampedTestY;
                
                // Создаем эффект появления
                createOptimizedParticles(
                    player.x + player.width / 2,
                    player.y + player.height / 2,
                    BOOSTER_TYPES.teleport.color,
                    30
                );
                
                return true; // Успешная телепортация
            }
        }
        
        // Если не нашли безопасную позицию, попробуем телепортироваться на минимальную дистанцию
        const minDistance = 100;
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const testX = player.x + Math.cos(angle) * minDistance;
            const testY = player.y + Math.sin(angle) * minDistance;
            const clampedTestX = Math.max(0, Math.min(GAME_CONFIG.worldWidth - player.width, testX));
            const clampedTestY = Math.max(0, Math.min(GAME_CONFIG.worldHeight - player.height, testY));
            
            if (!checkWallCollision(player, clampedTestX, clampedTestY)) {
                // Создаем эффект исчезновения
                createOptimizedParticles(
                    player.x + player.width / 2,
                    player.y + player.height / 2,
                    BOOSTER_TYPES.teleport.color,
                    20
                );
                
                // Телепортируем игрока
                player.x = clampedTestX;
                player.y = clampedTestY;
                player.lastSafeX = clampedTestX;
                player.lastSafeY = clampedTestY;
                
                // Создаем эффект появления
                createOptimizedParticles(
                    player.x + player.width / 2,
                    player.y + player.height / 2,
                    BOOSTER_TYPES.teleport.color,
                    20
                );
                
                return true; // Успешная телепортация на минимальную дистанцию
            }
        }
    }
    
    return false; // Не удалось телепортироваться
}

// ===============================
// ОБНОВЛЕНИЕ ИГРОКА
// ===============================

function updatePlayer(player, controls, deltaTime, characterType) {
    // Обновляем кулдаун призрака/телепорта
    if (player.ghostCooldown > 0) {
        player.ghostCooldown -= deltaTime;
    }
    
    // Обработка кнопки действия
    if (keys[controls.action] && !player.actionPressed && player.ghostCooldown <= 0) {
        player.actionPressed = true;
        
        // Разные способности в зависимости от типа персонажа
        if (characterType === 'punk') {
            // Призрак для Сани - кулдаун 8 секунд
            player.ghostCooldown = getCharacterCooldown(characterType);
            player.boosts.set('ghost', {
                duration: 1000,
                startTime: Date.now()
            });
            
            // Создаем эффект активации призрака
            createOptimizedParticles(
                player.x + player.width / 2,
                player.y + player.height / 2,
                '#9c88ff',
                15
            );
        } else if (characterType === 'businessman') {
            // Телепортация для Лехи - кулдаун 5 секунд
            if (teleportPlayer(player)) {
                player.ghostCooldown = getCharacterCooldown(characterType);
                // Создаём эффект активации телепорта
                createOptimizedParticles(
                    player.x + player.width / 2,
                    player.y + player.height / 2,
                    BOOSTER_TYPES.teleport.color,
                    20
                );
            }
        } else if (characterType === 'kok') {
            // Ускорение для Степы - кулдаун 5 секунд
            player.ghostCooldown = getCharacterCooldown(characterType);
            player.boosts.set('speed', {
                duration: 2000, // 2 секунды ускорения
                startTime: Date.now()
            });
            
            // Создаем эффект активации ускорения
            createOptimizedParticles(
                player.x + player.width / 2,
                player.y + player.height / 2,
                '#00ff88',
                20
            );
        } else if (characterType === 'maks') {
            // Гигант для Макса - кулдаун 8 секунд
            player.ghostCooldown = getCharacterCooldown(characterType);
            player.boosts.set('giant', {
                duration: 1500, // 1.5 секунды гиганта
                startTime: Date.now()
            });
            
            // Создаем эффект активации гиганта
            createOptimizedParticles(
                player.x + player.width / 2,
                player.y + player.height / 2,
                '#ffd700', // Желтый цвет как у бустера гиганта
                25
            );
        }
    }
    
    // Сброс флага кнопки когда отпускают
    if (!keys[controls.action]) {
        player.actionPressed = false;
    }
    
    // Обновляем бустеры
    for (const [type, boost] of player.boosts) {
        boost.duration -= deltaTime;
        if (boost.duration <= 0) {
            player.boosts.delete(type);
        }
    }
    
    // Обновляем анимацию гиганта
    if (player.boosts.has('giant')) {
        player.isGiant = true;
        player.giantAnimationTime += deltaTime;
        
        // Плавная анимация увеличения до 2x размера
        const animationDuration = 500; // 0.5 секунды на анимацию
        if (player.giantAnimationTime <= animationDuration) {
            const progress = player.giantAnimationTime / animationDuration;
            player.giantScale = 1 + progress; // От 1x до 2x
        } else {
            player.giantScale = 2; // Максимальный размер 2x
        }
        
        // Обновляем размеры игрока
        player.width = player.originalWidth * player.giantScale;
        player.height = player.originalHeight * player.giantScale;
        
        // Постоянное разрушение стен во время действия бустера
        // Проверяем каждые 200ms для плавности
        if (!player.lastWallBreakTime || Date.now() - player.lastWallBreakTime > 200) {
            breakWalls(player);
            player.lastWallBreakTime = Date.now();
        }
    } else {
        // Возвращаем к нормальному размеру
        if (player.isGiant) {
            player.isGiant = false;
            player.giantAnimationTime = 0;
            player.giantScale = 1;
            player.width = player.originalWidth;
            player.height = player.originalHeight;
            player.lastWallBreakTime = 0; // Сбрасываем таймер
        }
    }
    
    // Применяем эффекты бустеров
    player.maxSpeed = player.characterType === 'punk' ? 7 : 
                     player.characterType === 'businessman' ? 7 : 7;
    player.isGhost = false;
    
    if (player.boosts.has('speed')) {
        if (player.characterType === 'kok') {
            player.maxSpeed *= 1.3; // Ускорение в 1.3 раза для Степы Кок
        } else {
            player.maxSpeed *= 1.6; // Обычное ускорение для бустеров
        }
    }
    if (player.boosts.has('ghost')) {
        player.isGhost = true;
    }
    
    // Управление
    let moveX = 0;
    let moveY = 0;
    
    if (keys[controls.left]) moveX -= 1;
    if (keys[controls.right]) moveX += 1;
    if (keys[controls.up]) moveY -= 1;
    if (keys[controls.down]) moveY += 1;
    
    // Нормализация диагонального движения
    if (moveX !== 0 && moveY !== 0) {
        moveX *= 0.707;
        moveY *= 0.707;
    }
    
    // Применение движения
    if (moveX !== 0 || moveY !== 0) {
        player.speed = Math.min(player.speed + player.acceleration, player.maxSpeed);
        player.angle = Math.atan2(moveY, moveX);
    } else {
        player.speed = Math.max(player.speed - player.acceleration * 2, 0);
    }
    
    // Вычисление новой позиции с более мягкой проверкой коллизий
    const moveSpeed = player.speed;
    const newX = player.x + Math.cos(player.angle) * moveSpeed;
    const newY = player.y + Math.sin(player.angle) * moveSpeed;
    
    // Сохраняем последнюю безопасную позицию
    if (!checkWallCollision(player, player.x, player.y)) {
        player.lastSafeX = player.x;
        player.lastSafeY = player.y;
    }
    
    // Проверка коллизий со стенами с отступом
    const margin = 2; // Отступ от стен
    if (!checkWallCollision(player, newX, player.y)) {
        player.x = newX;
    } else {
        // Попытка скольжения по стене
        if (!checkWallCollision(player, player.x + Math.cos(player.angle) * moveSpeed * 0.3, player.y)) {
            player.x += Math.cos(player.angle) * moveSpeed * 0.3;
        }
    }
    
    if (!checkWallCollision(player, player.x, newY)) {
        player.y = newY;
    } else {
        // Попытка скольжения по стене
        if (!checkWallCollision(player, player.x, player.y + Math.sin(player.angle) * moveSpeed * 0.3)) {
            player.y += Math.sin(player.angle) * moveSpeed * 0.3;
        }
    }
    
    // Проверка на застревание в стене после призрака
    if (!player.isGhost && checkWallCollision(player, player.x, player.y)) {
        // Сначала пробуем вернуться на последнюю безопасную позицию
        if (!checkWallCollision(player, player.lastSafeX, player.lastSafeY)) {
            player.x = player.lastSafeX;
            player.y = player.lastSafeY;
        } else {
            // Если не получилось, используем улучшенный механизм выталкивания
            const directions = [];
            const steps = 64; // Увеличиваем количество направлений для более точного поиска
            const maxDistance = 150; // Увеличиваем максимальное расстояние для поиска безопасной позиции
            
            // Создаем спиральный паттерн направлений с более плотной сеткой
            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * Math.PI * 2;
                const distance = (i / steps) * maxDistance;
                directions.push({
                    x: Math.cos(angle) * distance,
                    y: Math.sin(angle) * distance
                });
            }
            
            // Добавляем дополнительные направления для более точного поиска
            for (let i = 0; i < 32; i++) {
                const angle = (i / 32) * Math.PI * 2;
                directions.push({
                    x: Math.cos(angle) * 30,
                    y: Math.sin(angle) * 30
                });
            }
            
            // Добавляем направления к центру карты для случаев застревания в углах
            const centerX = GAME_CONFIG.worldWidth / 2;
            const centerY = GAME_CONFIG.worldHeight / 2;
            const toCenterX = centerX - player.x;
            const toCenterY = centerY - player.y;
            const centerDistance = Math.hypot(toCenterX, toCenterY);
            
            if (centerDistance > 0) {
                directions.push({
                    x: (toCenterX / centerDistance) * 100,
                    y: (toCenterY / centerDistance) * 100
                });
            }
            
            // Сортируем направления по расстоянию от текущей позиции
            directions.sort((a, b) => {
                const distA = Math.hypot(a.x, a.y);
                const distB = Math.hypot(b.x, b.y);
                return distA - distB;
            });
            
            let foundSafePosition = false;
            
            // Пробуем вытолкнуть в каждом направлении
            for (const dir of directions) {
                const testX = player.x + dir.x;
                const testY = player.y + dir.y;
                
                // Ограничиваем позицию в пределах мира
                const clampedX = Math.max(20, Math.min(GAME_CONFIG.worldWidth - player.width - 20, testX));
                const clampedY = Math.max(20, Math.min(GAME_CONFIG.worldHeight - player.height - 20, testY));
                
                if (!checkWallCollision(player, clampedX, clampedY)) {
                    player.x = clampedX;
                    player.y = clampedY;
                    player.lastSafeX = clampedX;
                    player.lastSafeY = clampedY;
                    foundSafePosition = true;
                    break;
                }
            }
            
            // Если не нашли безопасную позицию, используем принудительное выталкивание
            if (!foundSafePosition) {
                // Пробуем вытолкнуть в 8 основных направлениях с большей силой
                const forceDirections = [
                    {x: -80, y: 0}, {x: 80, y: 0}, {x: 0, y: -80}, {x: 0, y: 80},
                    {x: -56, y: -56}, {x: 56, y: -56}, {x: -56, y: 56}, {x: 56, y: 56}
                ];
                
                for (const dir of forceDirections) {
                    const testX = player.x + dir.x;
                    const testY = player.y + dir.y;
                    
                    // Ограничиваем позицию в пределах мира
                    const clampedX = Math.max(20, Math.min(GAME_CONFIG.worldWidth - player.width - 20, testX));
                    const clampedY = Math.max(20, Math.min(GAME_CONFIG.worldHeight - player.height - 20, testY));
                    
                    if (!checkWallCollision(player, clampedX, clampedY)) {
                        player.x = clampedX;
                        player.y = clampedY;
                        player.lastSafeX = clampedX;
                        player.lastSafeY = clampedY;
                        foundSafePosition = true;
                        break;
                    }
                }
                
                // Последняя попытка - телепортация на случайную позицию в центре карты
                if (!foundSafePosition) {
                    let attempts = 0;
                    while (attempts < 100) {
                        // Генерируем позицию ближе к центру карты
                        const centerX = GAME_CONFIG.worldWidth / 2;
                        const centerY = GAME_CONFIG.worldHeight / 2;
                        const radius = Math.min(GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight) / 4;
                        
                        const randomAngle = Math.random() * Math.PI * 2;
                        const randomRadius = Math.random() * radius;
                        
                        const randomX = centerX + Math.cos(randomAngle) * randomRadius;
                        const randomY = centerY + Math.sin(randomAngle) * randomRadius;
                        
                        // Ограничиваем позицию в пределах мира
                        const clampedX = Math.max(20, Math.min(GAME_CONFIG.worldWidth - player.width - 20, randomX));
                        const clampedY = Math.max(20, Math.min(GAME_CONFIG.worldHeight - player.height - 20, randomY));
                        
                        if (!checkWallCollision(player, clampedX, clampedY)) {
                            player.x = clampedX;
                            player.y = clampedY;
                            player.lastSafeX = clampedX;
                            player.lastSafeY = clampedY;
                            foundSafePosition = true;
                            break;
                        }
                        attempts++;
                    }
                }
            }
            
            // Если всё ещё не нашли безопасную позицию, принудительно телепортируем в центр карты
            if (!foundSafePosition) {
                const centerX = GAME_CONFIG.worldWidth / 2;
                const centerY = GAME_CONFIG.worldHeight / 2;
                player.x = centerX;
                player.y = centerY;
                player.lastSafeX = centerX;
                player.lastSafeY = centerY;
            }
        }
    }
    
    // Ограничения мира с дополнительным отступом
    const worldMargin = 20;
    player.x = Math.max(worldMargin, Math.min(GAME_CONFIG.worldWidth - player.width - worldMargin, player.x));
    player.y = Math.max(worldMargin, Math.min(GAME_CONFIG.worldHeight - player.height - worldMargin, player.y));
    
    // Обновление следа
    if (player.speed > 2) {
        player.trail.push({
            x: player.x + player.width / 2,
            y: player.y + player.height / 2,
            life: 800,
            opacity: 1
        });
    }
    
    player.trail = player.trail.filter(point => {
        point.life -= deltaTime;
        point.opacity = point.life / 800;
        return point.life > 0;
    });
}

// ===============================
// ОТРИСОВКА
// ===============================

function drawBackground(ctx, offsetX, offsetY) {
    // Градиентный фон
    const gradient = ctx.createRadialGradient(
        GAME_CONFIG.canvasWidth / 2, GAME_CONFIG.canvasHeight / 2, 0,
        GAME_CONFIG.canvasWidth / 2, GAME_CONFIG.canvasHeight / 2, GAME_CONFIG.canvasWidth
    );
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f0f23');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME_CONFIG.canvasWidth, GAME_CONFIG.canvasHeight);
    
    // Видимая граница внизу экрана (за пределами игровой зоны)
    const borderY = GAME_CONFIG.worldHeight - offsetY;
    if (borderY > 0 && borderY < GAME_CONFIG.canvasHeight) {
        // Градиентная граница
        const borderGradient = ctx.createLinearGradient(0, borderY, 0, borderY + 20);
        borderGradient.addColorStop(0, 'rgba(255, 0, 0, 0.8)');
        borderGradient.addColorStop(0.5, 'rgba(255, 0, 0, 0.4)');
        borderGradient.addColorStop(1, 'rgba(255, 0, 0, 0.1)');
        
        ctx.fillStyle = borderGradient;
        ctx.fillRect(0, borderY, GAME_CONFIG.canvasWidth, 20);
        
        // Неоновая линия
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, borderY);
        ctx.lineTo(GAME_CONFIG.canvasWidth, borderY);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

function drawMaze(ctx, offsetX, offsetY) {
    walls.forEach(wall => {
        const x = wall.x - offsetX;
        const y = wall.y - offsetY;
        
        if (x > -GAME_CONFIG.cellSize && x < GAME_CONFIG.canvasWidth && 
            y > -GAME_CONFIG.cellSize && y < GAME_CONFIG.canvasHeight) {
            
            // Градиент для стен
            const gradient = ctx.createLinearGradient(x, y, x + wall.width, y + wall.height);
            gradient.addColorStop(0, '#2c3e50');
            gradient.addColorStop(0.5, '#34495e');
            gradient.addColorStop(1, '#2c3e50');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, wall.width, wall.height);
            
            // Неоновые границы
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 10;
            ctx.strokeRect(x, y, wall.width, wall.height);
            ctx.shadowBlur = 0;
        }
    });
}

function drawPlayer(ctx, player, offsetX, offsetY) {
    const x = player.x + player.width / 2 - offsetX;
    const y = player.y + player.height / 2 - offsetY;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.angle + Math.PI / 2);
    
    // Эффект призрака
    if (player.isGhost) {
        ctx.globalAlpha = 0.6;
        ctx.shadowColor = '#9c88ff';
        ctx.shadowBlur = 20;
    }
    
    // Эффект гиганта
    if (player.isGiant) {
        ctx.shadowColor = BOOSTER_TYPES.giant.glowColor;
        ctx.shadowBlur = 30;
        ctx.globalAlpha = 0.9;
        
        // Добавляем эффект дрожания для гиганта
        const shake = Math.sin(Date.now() * 0.01) * 2;
        ctx.translate(shake, shake);
    }
    
    // Масштабирование для гиганта
    if (player.giantScale > 1) {
        ctx.scale(player.giantScale, player.giantScale);
    }
    
    if (player.characterType === 'punk') {
        // Панк с ирокезом - увеличенный и детализированный
        // Тело
        ctx.fillStyle = '#1e3799';
        ctx.fillRect(-18, -12, 36, 40);
        
        // Голова
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-15, -30, 30, 25);
        
        // Ирокез
        ctx.fillStyle = '#2c2c54';
        ctx.fillRect(-4, -42, 8, 18);
        
        // Детали лица
        ctx.fillStyle = '#000';
        ctx.fillRect(-10, -25, 4, 4);
        ctx.fillRect(6, -25, 4, 4);
        
        // Рот
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(-6, -18, 12, 3);
        
        // Руки
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-25, -8, 10, 18);
        ctx.fillRect(15, -8, 10, 18);
        
        // Ноги
        ctx.fillStyle = '#2c2c54';
        ctx.fillRect(-12, 28, 10, 18);
        ctx.fillRect(2, 28, 10, 18);
        
    } else if (player.characterType === 'businessman') {
        // Бизнесмен - детализированный
        // Тело (костюм)
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(-15, -10, 30, 38);
        
        // Рубашка
        ctx.fillStyle = '#ecf0f1';
        ctx.fillRect(-12, -8, 24, 30);
        
        // Галстук
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(-3, -8, 6, 25);
        
        // Голова
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-12, -27, 24, 22);
        
        // Волосы
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(-12, -30, 24, 10);
        
        // Борода
        ctx.fillStyle = '#654321';
        ctx.fillRect(-10, -10, 20, 8);
        
        // Глаза
        ctx.fillStyle = '#000';
        ctx.fillRect(-8, -22, 3, 3);
        ctx.fillRect(5, -22, 3, 3);
        
        // Руки
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-20, -5, 8, 15);
        ctx.fillRect(12, -5, 8, 15);
        
        // Ноги
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(-10, 28, 8, 15);
        ctx.fillRect(2, 28, 8, 15);
    } else if (player.characterType === 'kok') {
        // Степа Кок - новый персонаж
        // Тело (темно-серая кофта)
        ctx.fillStyle = '#4a4a4a';
        ctx.fillRect(-16, -10, 32, 38);
        
        // Руки
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-22, -8, 8, 16);
        ctx.fillRect(14, -8, 8, 16);
        
        // Голова
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-12, -25, 24, 20);
        
        // Волнистые волосы средней длины
        ctx.fillStyle = '#8b4513';
        ctx.beginPath();
        ctx.arc(-8, -28, 6, 0, Math.PI * 2);
        ctx.arc(-2, -30, 5, 0, Math.PI * 2);
        ctx.arc(4, -29, 6, 0, Math.PI * 2);
        ctx.arc(10, -27, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Зеленые глаза
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(-8, -20, 3, 3);
        ctx.fillRect(5, -20, 3, 3);
        
        // Рот
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(-4, -15, 8, 2);
        
        // Цепочка с подвеской на шее
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, -5, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(-2, -3, 4, 6);
        
        // Ноги (темно-синие джинсы)
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(-10, 28, 8, 15);
        ctx.fillRect(2, 28, 8, 15);
        
        // Кеды
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-12, 43, 12, 4);
        ctx.fillRect(0, 43, 12, 4);
    } else if (player.characterType === 'maks') {
        // Макс Здоровый - новый персонаж
        // Тело (темно-синяя кофта)
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(-19, -10, 38, 38);
        
        // Руки
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-25, -8, 10, 16);
        ctx.fillRect(15, -8, 10, 16);
        
        // Голова
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-15, -25, 30, 20);
        
        // Светло-русые короткие волосы
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(-15, -30, 30, 8);
        
        // Голубые глаза
        ctx.fillStyle = '#87ceeb';
        ctx.fillRect(-10, -18, 4, 4);
        ctx.fillRect(6, -18, 4, 4);
        
        // Массивная челюсть
        ctx.fillStyle = '#feca57';
        ctx.fillRect(-12, -8, 24, 6);
        
        // Рот
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(-5, -12, 10, 2);
        
        // Ноги (светло-серые треники)
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(-12, 28, 10, 15);
        ctx.fillRect(2, 28, 10, 15);
        
        // Белые кросы
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-15, 43, 15, 4);
        ctx.fillRect(0, 43, 15, 4);
    }
    
    ctx.restore();
    
    // След
    player.trail.forEach(point => {
        ctx.save();
        ctx.globalAlpha = point.opacity * 0.7;
        ctx.fillStyle = player.characterType === 'punk' ? '#ff4757' : 
                       player.characterType === 'businessman' ? '#3742fa' : 
                       player.characterType === 'kok' ? '#00ff88' : '#ffd700';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(point.x - offsetX, point.y - offsetY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

function drawBooster(ctx, booster, offsetX, offsetY) {
    if (booster.collected) return;
    
    const x = booster.x + booster.width / 2 - offsetX;
    const y = booster.y + booster.height / 2 - offsetY;
    
    if (x < -50 || x > GAME_CONFIG.canvasWidth + 50 || 
        y < -50 || y > GAME_CONFIG.canvasHeight + 50) return;
    
    const boosterType = BOOSTER_TYPES[booster.type];
    const size = 15 + Math.sin(booster.pulse) * 4;
    
    ctx.save();
    ctx.globalAlpha = booster.opacity;
    ctx.translate(x, y);
    ctx.rotate(booster.rotation);
    
    // Специальные эффекты для телепорта
    if (booster.type === 'teleport') {
        // Дополнительное свечение для телепорта
        ctx.shadowColor = boosterType.glowColor;
        ctx.shadowBlur = 35;
        
        // Внешний круг с пульсацией
        const outerSize = size + 8 + Math.sin(booster.pulse * 2) * 6;
        ctx.strokeStyle = boosterType.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, outerSize, 0, Math.PI * 2);
        ctx.stroke();
        
        // Средний круг
        const middleSize = size + 4;
        ctx.strokeStyle = boosterType.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = booster.opacity * 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, middleSize, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.globalAlpha = booster.opacity;
    }
    
    // Специальные эффекты для гиганта
    if (booster.type === 'giant') {
        // Усиленное свечение для гиганта
        ctx.shadowColor = boosterType.glowColor;
        ctx.shadowBlur = 40;
        
        // Внешний круг с пульсацией
        const outerSize = size + 12 + Math.sin(booster.pulse * 1.5) * 8;
        ctx.strokeStyle = boosterType.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, outerSize, 0, Math.PI * 2);
        ctx.stroke();
        
        // Средний круг
        const middleSize = size + 6;
        ctx.strokeStyle = boosterType.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = booster.opacity * 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, middleSize, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.globalAlpha = booster.opacity;
        
        // Эффект дрожания для гиганта
        const shake = Math.sin(booster.pulse * 3) * 2;
        ctx.translate(shake, shake);
    }
    
    // Свечение
    ctx.shadowColor = boosterType.glowColor;
    ctx.shadowBlur = 25;
    
    // Основной круг
    ctx.fillStyle = boosterType.color;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    
    // Внутренний символ
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(boosterType.symbol, 0, 0);
    
    ctx.restore();
}

function drawMinimap() {
    const minimapWidth = minimap.width;
    const minimapHeight = minimap.height;
    
    // Вычисляем масштаб на основе пропорций игрового мира
    const scaleX = minimapWidth / GAME_CONFIG.worldWidth;
    const scaleY = minimapHeight / GAME_CONFIG.worldHeight;
    const scale = Math.min(scaleX, scaleY); // Используем меньший масштаб для сохранения пропорций
    
    // Вычисляем отступы для центрирования
    const offsetX = (minimapWidth - GAME_CONFIG.worldWidth * scale) / 2;
    const offsetY = (minimapHeight - GAME_CONFIG.worldHeight * scale) / 2;
    
    minimapCtx.clearRect(0, 0, minimapWidth, minimapHeight);
    
    // Фон миникарты
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    minimapCtx.fillRect(0, 0, minimapWidth, minimapHeight);
    
    // Рамка
    minimapCtx.strokeStyle = '#00ff88';
    minimapCtx.lineWidth = 2;
    minimapCtx.strokeRect(1, 1, minimapWidth - 2, minimapHeight - 2);
    
    // Стены
    minimapCtx.fillStyle = '#334155';
    walls.forEach(wall => {
        minimapCtx.fillRect(
            wall.x * scale + offsetX,
            wall.y * scale + offsetY,
            Math.max(1, wall.width * scale),
            Math.max(1, wall.height * scale)
        );
    });
    
    // Бустеры
    boosters.forEach(booster => {
        if (!booster.collected) {
            minimapCtx.save();
            minimapCtx.strokeStyle = '#ffd700';
            minimapCtx.lineWidth = 2;
            minimapCtx.shadowColor = '#ffd700';
            minimapCtx.shadowBlur = 8;
            minimapCtx.beginPath();
            minimapCtx.arc(
                booster.x * scale + offsetX,
                booster.y * scale + offsetY,
                5, 0, Math.PI * 2
            );
            minimapCtx.stroke();
            minimapCtx.shadowBlur = 0;
            minimapCtx.fillStyle = '#fff200';
            minimapCtx.beginPath();
            minimapCtx.arc(
                booster.x * scale + offsetX,
                booster.y * scale + offsetY,
                3, 0, Math.PI * 2
            );
            minimapCtx.fill();
            minimapCtx.restore();
        }
    });
    
    // Охотник (красная точка)
    if (hunterPlayer) {
        minimapCtx.fillStyle = '#ef4444';
        minimapCtx.shadowColor = '#ef4444';
        minimapCtx.shadowBlur = 8;
        minimapCtx.beginPath();
        minimapCtx.arc(
            hunterPlayer.x * scale + offsetX,
            hunterPlayer.y * scale + offsetY,
            4, 0, Math.PI * 2
        );
        minimapCtx.fill();
        minimapCtx.shadowBlur = 0;
    }
    
    // Добыча (синяя точка)
    if (preyPlayer) {
        minimapCtx.fillStyle = '#3b82f6';
        minimapCtx.shadowColor = '#3b82f6';
        minimapCtx.shadowBlur = 8;
        minimapCtx.beginPath();
        minimapCtx.arc(
            preyPlayer.x * scale + offsetX,
            preyPlayer.y * scale + offsetY,
            4, 0, Math.PI * 2
        );
        minimapCtx.fill();
        minimapCtx.shadowBlur = 0;
    }
}

function render() {
    // Разделенный экран
    const splitY = GAME_CONFIG.canvasHeight / 2;

    // Верхняя половина - вид охотника
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, GAME_CONFIG.canvasWidth, splitY);
    ctx.clip();

    // Верхняя камера всегда следует за охотником
    if (hunterPlayer && typeof hunterPlayer.x === 'number' && typeof hunterPlayer.y === 'number') {
        const offsetX1 = hunterPlayer.x - GAME_CONFIG.canvasWidth / 2;
        const offsetY1 = hunterPlayer.y - splitY / 2;

        // 🚀 Используем оптимизированную отрисовку фона
        drawOptimizedBackground(ctx, offsetX1, offsetY1);
        drawMaze(ctx, offsetX1, offsetY1);
        
        // 🚀 Оптимизированная отрисовка бустеров (только видимые)
        boosters.forEach(booster => {
            const boosterX = booster.x - offsetX1;
            const boosterY = booster.y - offsetY1;
            if (boosterX > -100 && boosterX < GAME_CONFIG.canvasWidth + 100 &&
                boosterY > -100 && boosterY < splitY + 100) {
                drawBooster(ctx, booster, offsetX1, offsetY1);
            }
        });
        
        // 🚀 Оптимизированная отрисовка частиц (только активные и видимые)
        particles.filter(p => p.active).forEach(particle => {
            const particleX = particle.x - offsetX1;
            const particleY = particle.y - offsetY1;
            if (particleX > -50 && particleX < GAME_CONFIG.canvasWidth + 50 &&
                particleY > -50 && particleY < splitY + 50) {
                particle.draw(ctx, offsetX1, offsetY1);
            }
        });
        
        if (hunterPlayer) drawPlayer(ctx, hunterPlayer, offsetX1, offsetY1);
        if (preyPlayer) drawPlayer(ctx, preyPlayer, offsetX1, offsetY1);
    }
    ctx.restore();

    // 🚀 Упрощенная разделительная линия
            ctx.strokeStyle = GAME_CONFIG.controlsSwapped ? '#ff4757' : '#00ff88';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, splitY);
    ctx.lineTo(GAME_CONFIG.canvasWidth, splitY);
    ctx.stroke();

    // Нижняя половина - вид добычи
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, splitY, GAME_CONFIG.canvasWidth, splitY);
    ctx.clip();

    // Нижняя камера всегда следует за добычей
    if (preyPlayer && typeof preyPlayer.x === 'number' && typeof preyPlayer.y === 'number') {
        const offsetX2 = preyPlayer.x - GAME_CONFIG.canvasWidth / 2;
        const offsetY2 = preyPlayer.y - splitY / 2 - splitY;

        // 🚀 Используем оптимизированную отрисовку фона
        drawOptimizedBackground(ctx, offsetX2, offsetY2);
        drawMaze(ctx, offsetX2, offsetY2);
        
        // 🚀 Оптимизированная отрисовка бустеров (только видимые)
        boosters.forEach(booster => {
            const boosterX = booster.x - offsetX2;
            const boosterY = booster.y - offsetY2;
            if (boosterX > -100 && boosterX < GAME_CONFIG.canvasWidth + 100 &&
                boosterY > splitY - 100 && boosterY < GAME_CONFIG.canvasHeight + 100) {
                drawBooster(ctx, booster, offsetX2, offsetY2);
            }
        });
        
        // 🚀 Оптимизированная отрисовка частиц (только активные и видимые)
        particles.filter(p => p.active).forEach(particle => {
            const particleX = particle.x - offsetX2;
            const particleY = particle.y - offsetY2;
            if (particleX > -50 && particleX < GAME_CONFIG.canvasWidth + 50 &&
                particleY > splitY - 50 && particleY < GAME_CONFIG.canvasHeight + 50) {
                particle.draw(ctx, offsetX2, offsetY2);
            }
        });
        
        if (hunterPlayer) drawPlayer(ctx, hunterPlayer, offsetX2, offsetY2);
        if (preyPlayer) drawPlayer(ctx, preyPlayer, offsetX2, offsetY2);
    }
    ctx.restore();

    // 🚀 Миникарта обновляется реже
    if (gameState.mode === 'playing' && frameCount % 3 === 0) {
        drawMinimap();
    }
    
    // 🚀 Показываем счетчик FPS
    if (gameState.mode === 'playing') {
        drawFPSCounter();
    }
    
    // 🎨 Показываем уведомления о смене графики
    drawGraphicsNotification();
}

// ===============================
// УПРАВЛЕНИЕ ИГРОЙ
// ===============================

function startGame() {
    // Проверяем, что персонажи выбраны
    if (!characterSelection.hunter || !characterSelection.prey) {
        alert('Пожалуйста, выберите персонажей для обеих ролей!');
        return;
    }
    
    document.getElementById('startScreen').classList.add('hide');
    gameState.mode = 'playing';
    gameState.startTime = Date.now();
    gameState.gameTime = 0;

    // Показываем игровые элементы
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
        gameContainer.classList.remove('start-screen-active');
        gameContainer.classList.add('game-active');
    }

    // Принудительно показываем кулдауны
    document.querySelectorAll('.cooldown-indicator').forEach(el => {
        el.style.display = 'block';
    });

    // Инициализируем названия способностей
    setTimeout(() => {
        updateCooldownLabels();
        // Debug: проверяем классы
        console.log('Game started, container classes:', gameContainer.className);
    }, 100);
    
    // Сбрасываем таймер бустеров для нового раунда
    // Устанавливаем время так, чтобы первый бустер появился после initialBoosterDelay
    GAME_CONFIG.lastBoosterSpawnTime = Date.now() - GAME_CONFIG.minBoosterInterval + GAME_CONFIG.initialBoosterDelay;
    
    // Получаем конфигурацию игроков
    playerConfig = getPlayerConfig();
    
    // Показываем обозначения ролей
    showRoleIndicators();
    
    // Скрываем информацию об управлении во время игры
    hideControlsInfo();
    
    // Генерация нового лабиринта
    generateMaze();
    
    // Случайные стартовые позиции для игроков
    function getRandomSpawnPoint() {
        let x, y;
        const margin = 100; // Увеличенный отступ от границ
        let attempts = 0;
        
        do {
            x = Math.random() * (GAME_CONFIG.worldWidth - 2 * margin) + margin;
            y = Math.random() * (GAME_CONFIG.worldHeight - 2 * margin) + margin;
            attempts++;
        } while (checkWallCollision({x: x, y: y, width: 35, height: 40}, x, y) && attempts < 100);
        
        // Если не нашли безопасную позицию, используем центр карты
        if (attempts >= 100) {
            x = GAME_CONFIG.worldWidth / 2;
            y = GAME_CONFIG.worldHeight / 2;
        }
        
        return {x, y};
    }
    
    // Обеспечиваем что игроки появляются на разумном расстоянии друг от друга
    const hunterSpawn = getRandomSpawnPoint();
    let preySpawn;
    do {
        preySpawn = getRandomSpawnPoint();
    } while (Math.hypot(preySpawn.x - hunterSpawn.x, preySpawn.y - hunterSpawn.y) < 300);
    
    // Размещаем игроков в зависимости от их конфигурации
    if (playerConfig.hunter.character === 'punk') {
        players.punk.x = hunterSpawn.x;
        players.punk.y = hunterSpawn.y;
    } else if (playerConfig.hunter.character === 'businessman') {
        players.businessman.x = hunterSpawn.x;
        players.businessman.y = hunterSpawn.y;
    } else if (playerConfig.hunter.character === 'kok') {
        players.kok.x = hunterSpawn.x;
        players.kok.y = hunterSpawn.y;
    } else if (playerConfig.hunter.character === 'maks') {
        players.maks.x = hunterSpawn.x;
        players.maks.y = hunterSpawn.y;
    }
    
    if (playerConfig.prey.character === 'punk') {
        players.punk.x = preySpawn.x;
        players.punk.y = preySpawn.y;
    } else if (playerConfig.prey.character === 'businessman') {
        players.businessman.x = preySpawn.x;
        players.businessman.y = preySpawn.y;
    } else if (playerConfig.prey.character === 'kok') {
        players.kok.x = preySpawn.x;
        players.kok.y = preySpawn.y;
    } else if (playerConfig.prey.character === 'maks') {
        players.maks.x = preySpawn.x;
        players.maks.y = preySpawn.y;
    }
    
    // Создаем отдельные копии игроков для избежания конфликтов
    if (playerConfig.hunter.character === 'punk') {
        hunterPlayer = createPlayerCopy(players.punk, 'punk');
        hunterPlayer.x = hunterSpawn.x;
        hunterPlayer.y = hunterSpawn.y;
    } else if (playerConfig.hunter.character === 'businessman') {
        hunterPlayer = createPlayerCopy(players.businessman, 'businessman');
        hunterPlayer.x = hunterSpawn.x;
        hunterPlayer.y = hunterSpawn.y;
    } else if (playerConfig.hunter.character === 'kok') {
        hunterPlayer = createPlayerCopy(players.kok, 'kok');
        hunterPlayer.x = hunterSpawn.x;
        hunterPlayer.y = hunterSpawn.y;
    } else if (playerConfig.hunter.character === 'maks') {
        hunterPlayer = createPlayerCopy(players.maks, 'maks');
        hunterPlayer.x = hunterSpawn.x;
        hunterPlayer.y = hunterSpawn.y;
    }
    
    if (playerConfig.prey.character === 'punk') {
        preyPlayer = createPlayerCopy(players.punk, 'punk');
        preyPlayer.x = preySpawn.x;
        preyPlayer.y = preySpawn.y;
    } else if (playerConfig.prey.character === 'businessman') {
        preyPlayer = createPlayerCopy(players.businessman, 'businessman');
        preyPlayer.x = preySpawn.x;
        preyPlayer.y = preySpawn.y;
    } else if (playerConfig.prey.character === 'kok') {
        preyPlayer = createPlayerCopy(players.kok, 'kok');
        preyPlayer.x = preySpawn.x;
        preyPlayer.y = preySpawn.y;
    } else if (playerConfig.prey.character === 'maks') {
        preyPlayer = createPlayerCopy(players.maks, 'maks');
        preyPlayer.x = preySpawn.x;
        preyPlayer.y = preySpawn.y;
    }
    
    // Очистка бустеров и частиц
    boosters = [];
    particles = [];
    
    // Очистка эффектов для новых игроков
    if (hunterPlayer) {
        hunterPlayer.boosts.clear();
        hunterPlayer.trail = [];
        hunterPlayer.ghostCooldown = 0;
        hunterPlayer.actionPressed = false;
    }
    
    if (preyPlayer) {
        preyPlayer.boosts.clear();
        preyPlayer.trail = [];
        preyPlayer.ghostCooldown = 0;
        preyPlayer.actionPressed = false;
    }
    
    // Стартовые бустеры в зависимости от типа персонажа
    // Убираем стартовый призрак - теперь он будет только при активации способности
    
    // Создание начальных бустеров
    for (let i = 0; i < 5; i++) {
        spawnBooster();
    }
    
    playBackgroundMusic();
}

function endGame(winner) {
    stopBackgroundMusic();
    gameState.mode = 'ended';
    gameState.winner = winner;

    // Скрываем игровые элементы при окончании игры
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
        gameContainer.classList.remove('game-active');
    }

    // Принудительно скрываем кулдауны
    document.querySelectorAll('.cooldown-indicator').forEach(el => {
        el.style.display = 'none';
    });
    
    // Скрываем обозначения ролей
    hideRoleIndicators();
    
    // Показываем информацию об управлении
    showControlsInfo();
    
    // Определяем, кто победил
    const hunterCharacter = characterSelection.hunter;
    const preyCharacter = characterSelection.prey;
    
    // Обновляем счет
    if (winner === 'hunter') {
        gameState.scores.hunter = (gameState.scores.hunter || 0) + 1;
    } else {
        gameState.scores.prey = (gameState.scores.prey || 0) + 1;
    }
    
    // Запускаем новую музыку в зависимости от победителя
    // Определяем кто победил по персонажу, а не по роли
    let winningCharacter = null;
    if (winner === 'hunter') {
        winningCharacter = hunterCharacter; // Персонаж охотника
    } else {
        winningCharacter = preyCharacter; // Персонаж добычи
    }
    
    // Проигрываем звук в зависимости от персонажа
    if (winningCharacter === 'punk') {
        // Саня победил - проигрываем звук победы охотника
        playMusic('victory');
    } else if (winningCharacter === 'businessman') {
        // Леха победил - проигрываем звук победы добычи
        playMusic('defeat');
    } else if (winningCharacter === 'kok') {
        // Степа Кок победил - проигрываем его победный звук
        const kokEndSound = document.getElementById('kokEndSound');
        if (kokEndSound) {
            kokEndSound.currentTime = 0;
            kokEndSound.play();
        }
    } else if (winningCharacter === 'maks') {
        // Макс Здоровый победил - проигрываем его звук
        const maksSound = document.getElementById('maksSound');
        if (maksSound) {
            maksSound.currentTime = 0;
            maksSound.play();
        }
    }
    
    const endScreen = document.getElementById('endScreen');
    const winnerText = document.getElementById('winnerText');
    const gameResult = document.getElementById('gameResult');
    
    // Создаем canvas для отрисовки лица победителя
    const winnerFaceCanvas = document.createElement('canvas');
    winnerFaceCanvas.className = 'evil-face';
    winnerFaceCanvas.width = 200;
    winnerFaceCanvas.height = 200;
    winnerFaceCanvas.style.width = '200px';
    winnerFaceCanvas.style.height = '200px';
    
    const faceCtx = winnerFaceCanvas.getContext('2d');
    
    // Обновляем текст с учетом выбранных персонажей
    if (winner === 'hunter') {
        const hunterName = hunterCharacter === 'punk' ? 'Саня' : 
                          hunterCharacter === 'businessman' ? 'Леха' : 
                          hunterCharacter === 'kok' ? 'Степа' : 'Макс';
        const preyName = preyCharacter === 'punk' ? 'Саня' : 
                        preyCharacter === 'businessman' ? 'Леха' : 
                        preyCharacter === 'kok' ? 'Степа' : 'Макс';
        winnerText.textContent = `🎯 ОХОТНИК ПОБЕДИЛ РАУНД!`;
        winnerText.style.color = '#00ff88';
        gameResult.textContent = `${hunterName} поймал ${preyName} за ${Math.floor(gameState.gameTime / 1000)} секунд!`;
        gameResult.innerHTML += `<br>Счет: Охотник ${gameState.scores.hunter || 0} - ${gameState.scores.prey || 0} Добыча`;
        
        if (hunterCharacter === 'punk') {
            drawPunkWinnerFace(faceCtx);
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #ff4757)';
        } else if (hunterCharacter === 'businessman') {
            drawBusinessmanWinnerFace(faceCtx);
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #3742fa)';
        } else if (hunterCharacter === 'kok') {
            drawKokWinnerFace(faceCtx); // Используем лицо Степы Кок
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #00ff88)';
        } else if (hunterCharacter === 'maks') {
            drawMaksWinnerFace(faceCtx); // Используем лицо Макса Здорового
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #ffd700)';
        }
    } else {
        const hunterName = hunterCharacter === 'punk' ? 'Саня' : 
                          hunterCharacter === 'businessman' ? 'Леха' : 
                          hunterCharacter === 'kok' ? 'Степа' : 'Макс';
        const preyName = preyCharacter === 'punk' ? 'Саня' : 
                        preyCharacter === 'businessman' ? 'Леха' : 
                        preyCharacter === 'kok' ? 'Степа' : 'Макс';
        winnerText.textContent = `🏃‍♂️ ДОБЫЧА ВЫЖИЛА В РАУНДЕ!`;
        winnerText.style.color = '#ff6b35';
        gameResult.textContent = `${preyName} успешно убегал от ${hunterName} целых 2 минуты!`;
        gameResult.innerHTML += `<br>Счет: Охотник ${gameState.scores.hunter || 0} - ${gameState.scores.prey || 0} Добыча`;
        
        if (preyCharacter === 'punk') {
            drawPunkWinnerFace(faceCtx);
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #ff4757)';
        } else if (preyCharacter === 'businessman') {
            drawBusinessmanWinnerFace(faceCtx);
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #3742fa)';
        } else if (preyCharacter === 'kok') {
            drawKokWinnerFace(faceCtx);
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #00ff88)';
        } else if (preyCharacter === 'maks') {
            drawMaksWinnerFace(faceCtx);
            winnerFaceCanvas.style.filter = 'drop-shadow(0 0 30px #ffd700)';
        }
    }
    
    // Проверяем, закончилась ли игра
    if (gameState.roundNumber >= GAME_CONFIG.totalRounds) {
        const finalWinner = (gameState.scores.hunter || 0) > (gameState.scores.prey || 0) ? 'hunter' : 'prey';
        winnerText.textContent = finalWinner === 'hunter' ? '🏆 ОХОТНИК ВЫИГРАЛ ИГРУ!' : '🏆 ДОБЫЧА ВЫИГРАЛА ИГРУ!';
        gameResult.innerHTML = `Финальный счет: Охотник ${gameState.scores.hunter || 0} - ${gameState.scores.prey || 0} Добыча`;
        
        // Скрываем кнопку реванша только в конце игры
        document.querySelector('button[onclick="nextRound()"]').style.display = 'none';
    } else {
        // Показываем кнопку реванша для всех остальных раундов
        document.querySelector('button[onclick="nextRound()"]').style.display = 'block';
    }
    
    // Добавляем лицо к экрану
    document.body.appendChild(winnerFaceCanvas);
    
    // Удаляем лицо через 3 секунды
    setTimeout(() => {
        if (winnerFaceCanvas.parentNode) {
            winnerFaceCanvas.parentNode.removeChild(winnerFaceCanvas);
        }
    }, 3000);
    
    endScreen.classList.remove('hide');
    
    // Создание праздничных частиц
    for (let i = 0; i < 100; i++) {
        const color = winner === 'hunter' ? '#00ff88' : '#ff6b35';
        createOptimizedParticles(
            Math.random() * GAME_CONFIG.worldWidth,
            Math.random() * GAME_CONFIG.worldHeight,
            color,
            1
        );
    }
}

function nextRound() {
    document.getElementById('endScreen').classList.add('hide');
    gameState.roundNumber++;
    
    // Скрываем информацию об управлении перед новым раундом
    hideControlsInfo();

    // Показываем игровые элементы снова
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
        gameContainer.classList.add('game-active');
    }
    
    // Запускаем новый раунд с теми же персонажами (реванш)
    startGame();
}

function restartGame() {
    stopBackgroundMusic();
    document.getElementById('endScreen').classList.add('hide');
    gameState.roundNumber = 1;
    gameState.scores = { hunter: 0, prey: 0 }; // Сбрасываем счет
    document.querySelector('button[onclick="nextRound()"]').style.display = 'block'; // Показываем кнопку следующего раунда
    
    // Сбрасываем выбор персонажей
    characterSelection.hunter = null;
    characterSelection.prey = null;
    
    // Убираем выделение с выбранных персонажей
    document.querySelectorAll('.character-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Возвращаемся на стартовый экран выбора персонажей
    document.getElementById('startScreen').classList.remove('hide');
    
    // Показываем информацию об управлении на экране старта
    showControlsInfo();
    
    // Скрываем игровые элементы
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
        gameContainer.classList.add('start-screen-active');
        gameContainer.classList.remove('game-active');
        // Debug: проверяем классы
        console.log('Game restarted, container classes:', gameContainer.className);
    }

    // Принудительно скрываем кулдауны
    document.querySelectorAll('.cooldown-indicator').forEach(el => {
        el.style.display = 'none';
    });
    
    // Сбрасываем состояние игры
    gameState.mode = 'start';
    playerConfig = null;
    hunterPlayer = null;
    preyPlayer = null;
    
    // Очищаем бустеры и частицы
    boosters = [];
    particles = [];
}

// ===============================
// ЛИЦА ПОБЕДИТЕЛЕЙ
// ===============================

function drawPunkWinnerFace(ctx) {
    const centerX = 100, centerY = 100;
    
    // Лицо
    ctx.fillStyle = '#feca57';
    ctx.fillRect(centerX - 40, centerY - 35, 80, 70);
    
    // Ирокез
    ctx.fillStyle = '#ff6b7a';
    ctx.fillRect(centerX - 20, centerY - 60, 40, 30);
    
    // Глаза
    ctx.fillStyle = '#2c2c54';
    ctx.fillRect(centerX - 25, centerY - 20, 8, 12);
    ctx.fillRect(centerX + 17, centerY - 20, 8, 12);
    
    // Улыбка
    ctx.fillRect(centerX - 20, centerY + 5, 40, 8);
    
    // Куртка
    ctx.fillStyle = '#1e3799';
    ctx.fillRect(centerX - 45, centerY + 35, 90, 50);
}

function drawBusinessmanWinnerFace(ctx) {
    const centerX = 100, centerY = 100;
    
    // Лицо
    ctx.fillStyle = '#f8c291';
    ctx.fillRect(centerX - 35, centerY - 30, 70, 60);
    
    // Волосы
    ctx.fillStyle = '#2c2c54';
    ctx.fillRect(centerX - 35, centerY - 45, 70, 20);
    
    // Глаза
    ctx.fillRect(centerX - 20, centerY - 15, 6, 8);
    ctx.fillRect(centerX + 14, centerY - 15, 6, 8);
    
    // Улыбка
    ctx.fillRect(centerX - 15, centerY + 5, 30, 6);
    
    // Костюм
    ctx.fillRect(centerX - 40, centerY + 35, 80, 50);
    
    // Галстук
    ctx.fillStyle = '#ff4757';
    ctx.fillRect(centerX - 8, centerY + 30, 16, 40);
}

function drawKokWinnerFace(ctx) {
    const centerX = 100, centerY = 100;
    
    // Лицо
    ctx.fillStyle = '#feca57';
    ctx.fillRect(centerX - 35, centerY - 30, 70, 60);
    
    // Волнистые волосы
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.arc(centerX - 20, centerY - 45, 8, 0, Math.PI * 2);
    ctx.arc(centerX - 8, centerY - 48, 7, 0, Math.PI * 2);
    ctx.arc(centerX + 4, centerY - 47, 8, 0, Math.PI * 2);
    ctx.arc(centerX + 16, centerY - 44, 7, 0, Math.PI * 2);
    ctx.fill();
    
    // Зеленые глаза
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(centerX - 20, centerY - 15, 6, 8);
    ctx.fillRect(centerX + 14, centerY - 15, 6, 8);
    
    // Улыбка
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(centerX - 15, centerY + 5, 30, 6);
    
    // Темно-серая кофта
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(centerX - 40, centerY + 35, 80, 50);
    
    // Цепочка
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY + 10, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(centerX - 3, centerY + 8, 6, 8);
}

function drawMaksWinnerFace(ctx) {
    const centerX = 100, centerY = 100;
    
    // Лицо
    ctx.fillStyle = '#feca57';
    ctx.fillRect(centerX - 40, centerY - 30, 80, 60);
    
    // Светло-русые короткие волосы
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(centerX - 40, centerY - 40, 80, 15);
    
    // Голубые глаза
    ctx.fillStyle = '#87ceeb';
    ctx.fillRect(centerX - 25, centerY - 15, 8, 10);
    ctx.fillRect(centerX + 17, centerY - 15, 8, 10);
    
    // Массивная челюсть
    ctx.fillStyle = '#feca57';
    ctx.fillRect(centerX - 30, centerY + 5, 60, 8);
    
    // Улыбка
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(centerX - 20, centerY + 15, 40, 4);
    
    // Темно-синяя кофта
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(centerX - 45, centerY + 35, 90, 50);
    
    // Светло-серые треники
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(centerX - 35, centerY + 85, 30, 25);
    ctx.fillRect(centerX + 5, centerY + 85, 30, 25);
    
    // Белые кросы
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(centerX - 40, centerY + 110, 40, 6);
    ctx.fillRect(centerX, centerY + 110, 40, 6);
}

// Запуск игры
requestAnimationFrame(gameLoop);

// Изменяем длительность режима призрака с 5 секунд на 1 секунду
if (gameState.businessmanGhostMode && Date.now() - gameState.businessmanGhostModeStart > 1000) {
    gameState.businessmanGhostMode = false;
}

// ===============================
// ВЫБОР ПЕРСОНАЖЕЙ
// ===============================

function selectCharacter(role, character) {
    // Проигрываем звук в зависимости от выбранного персонажа
    if (character === 'punk') {
        // Звук для Сани
        const sanyaSound = document.getElementById('sanyaSound');
        if (sanyaSound) {
            sanyaSound.currentTime = 0;
            sanyaSound.play();
        }
    } else if (character === 'businessman') {
        // Звук для Лехи
        const lehaSound = document.getElementById('lehaSound');
        if (lehaSound) {
            lehaSound.currentTime = 0;
            lehaSound.play();
        }
    } else if (character === 'kok') {
        // Звук для Степы Кок
        const kokSound = document.getElementById('kokSound');
        if (kokSound) {
            kokSound.currentTime = 0;
            kokSound.play();
        }
    } else if (character === 'maks') {
        // Звук для Макса Здорового
        const maksSound = document.getElementById('maksSound');
        if (maksSound) {
            maksSound.currentTime = 0;
            maksSound.play();
        }
    }
    
    // Убираем предыдущий выбор для этой роли
    const roleSections = document.querySelectorAll('.role-section');
    roleSections.forEach(section => {
        const options = section.querySelectorAll('.character-option');
        options.forEach(option => {
            if (option.onclick && option.onclick.toString().includes(role)) {
                option.classList.remove('selected');
            }
        });
    });
    
    // Выбираем новый персонаж
    characterSelection[role] = character;
    
    // Добавляем визуальное выделение
    const selectedOption = document.querySelector(`.character-option[onclick*="${role}"][onclick*="${character}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    // Обновляем информацию об управлении
    updateControlsInfo();
    
    // Проверяем, можно ли активировать кнопку старта
    checkStartButton();
}

function checkStartButton() {
    const startButton = document.getElementById('startButton');
    if (characterSelection.hunter && characterSelection.prey) {
        startButton.classList.add('active');
    } else {
        startButton.classList.remove('active');
    }
}

function getPlayerConfig() {
    // Определяем, кто за кого играет
    const hunterCharacter = characterSelection.hunter;
    const preyCharacter = characterSelection.prey;
    
    // 🎮 Определяем управления с учетом переключателя
    const wasdControls = {
        up: 'KeyW',
        down: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        action: 'KeyE'
    };
    
    const arrowControls = {
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        action: 'Slash'
    };
    
    let hunterControls, preyControls;
    
    if (GAME_CONFIG.controlsSwapped) {
        // Поменяно: охотник стрелочки, добыча WASD
        hunterControls = arrowControls;
        preyControls = wasdControls;
    } else {
        // Стандартно: охотник WASD, добыча стрелочки
        hunterControls = wasdControls;
        preyControls = arrowControls;
    }
    
    return {
        hunter: {
            character: hunterCharacter,
            controls: hunterControls,
            isPunk: hunterCharacter === 'punk'
        },
        prey: {
            character: preyCharacter,
            controls: preyControls,
            isPunk: preyCharacter === 'punk'
        }
    };
}

// ===============================
// УПРАВЛЕНИЕ ОБОЗНАЧЕНИЯМИ РОЛЕЙ
// ===============================

function showRoleIndicators() {
    if (playerConfig) {
        const hunterName = playerConfig.hunter.character === 'punk' ? 'Саня' : 
                          playerConfig.hunter.character === 'businessman' ? 'Леха' : 
                          playerConfig.hunter.character === 'kok' ? 'Степа' : 'Макс';
        const preyName = playerConfig.prey.character === 'punk' ? 'Саня' : 
                        playerConfig.prey.character === 'businessman' ? 'Леха' : 
                        playerConfig.prey.character === 'kok' ? 'Степа' : 'Макс';
        
        toggleUI('hunterIndicator', true);
        toggleUI('preyIndicator', true);
        
        const hunterIndicator = document.getElementById('hunterIndicator');
        const preyIndicator = document.getElementById('preyIndicator');
        
        if (hunterIndicator) hunterIndicator.textContent = `🎯 ОХОТНИК - ${hunterName}`;
        if (preyIndicator) preyIndicator.textContent = `🏃‍♂️ ДОБЫЧА - ${preyName}`;
    }
}

function hideRoleIndicators() {
    toggleUI('hunterIndicator', false);
    toggleUI('preyIndicator', false);
}

// ===============================
// УПРАВЛЕНИЕ ИНФОРМАЦИЕЙ ОБ УПРАВЛЕНИИ
// ===============================

function showControlsInfo() {
    const controlsInfo = document.querySelector('.game-controls-info');
    if (controlsInfo) controlsInfo.style.display = 'block';
}

function hideControlsInfo() {
    const controlsInfo = document.querySelector('.game-controls-info');
    if (controlsInfo) controlsInfo.style.display = 'none';
}

function updateControlsInfo() {
    const hunterTitle = document.querySelector('.role-section:first-child .role-title');
    const preyTitle = document.querySelector('.role-section:last-child .role-title');
    const hunterCooldownLabel = document.querySelector('.hunter-cooldown-indicator .cooldown-label');
    const preyCooldownLabel = document.querySelector('.prey-cooldown-indicator .cooldown-label');
    
    if (!hunterTitle || !preyTitle) return;
    
    // Динамически обновляем подписи в зависимости от состояния переключателя
    if (GAME_CONFIG.controlsSwapped) {
        // Управления поменяны местами
        hunterTitle.textContent = '🎯 ОХОТНИК: Стрелочки + /';
        preyTitle.textContent = '🏃‍♂️ ДОБЫЧА: WASD + E';
        
        // Обновляем и подписи кулдаунов
        if (hunterCooldownLabel) hunterCooldownLabel.textContent = '🎯 Охотник (/)';
        if (preyCooldownLabel) preyCooldownLabel.textContent = '🏃‍♂️ Добыча (E)';
    } else {
        // Стандартные управления
        hunterTitle.textContent = '🎯 ОХОТНИК: WASD + E';
        preyTitle.textContent = '🏃‍♂️ ДОБЫЧА: Стрелочки + /';
        
        // Обновляем и подписи кулдаунов
        if (hunterCooldownLabel) hunterCooldownLabel.textContent = '🎯 Охотник (E)';
        if (preyCooldownLabel) preyCooldownLabel.textContent = '🏃‍♂️ Добыча (/)';
    }
}

// ===============================
// ИНИЦИАЛИЗАЦИЯ
// ===============================

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Скрываем обозначения ролей при загрузке
    hideRoleIndicators();
    
    // Показываем информацию об управлении на экране старта
    showControlsInfo();
    
    // Обновляем информацию об управлении
    updateControlsInfo();
    
    // Инициализируем переключатель графики
    initGraphicsToggle();
    
    // Проверяем кнопку старта
    checkStartButton();
    
    // Запускаем игровой цикл
    requestAnimationFrame(gameLoop);
});

// ===============================
// СОЗДАНИЕ КОПИЙ ИГРОКОВ
// ===============================

function createPlayerCopy(originalPlayer, characterType) {
    return {
        x: originalPlayer.x,
        y: originalPlayer.y,
        width: originalPlayer.width,
        height: originalPlayer.height,
        speed: originalPlayer.speed,
        maxSpeed: originalPlayer.maxSpeed,
        acceleration: originalPlayer.acceleration,
        angle: originalPlayer.angle,
        isGhost: false,
        ghostCooldown: 0,
        actionPressed: false,
        boosts: new Map(),
        trail: [],
        lastSafeX: originalPlayer.x,
        lastSafeY: originalPlayer.y,
        characterType: characterType,
        // Свойства для анимации гиганта
        originalWidth: originalPlayer.originalWidth || originalPlayer.width,
        originalHeight: originalPlayer.originalHeight || originalPlayer.height,
        giantScale: 1,
        giantAnimationTime: 0,
        isGiant: false,
        lastWallBreakTime: 0
    };
}

// ===============================
// UI ФУНКЦИИ
// ===============================

function toggleUI(elementId, show) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = show ? 'block' : 'none';
    }
}

// ===============================
// ЛОМАНИЕ СТЕН (ГИГАНТ)
// ===============================

function breakWalls(player) {
    const breakRadius = 80; // Радиус разрушения стен
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    
    // Создаем эффект разрушения только если есть стены для разрушения
    let wallsDestroyed = 0;
    
    // Проверяем все стены в радиусе
    const wallsToRemove = [];
    for (let i = walls.length - 1; i >= 0; i--) {
        const wall = walls[i];
        const wallCenterX = wall.x + wall.width / 2;
        const wallCenterY = wall.y + wall.height / 2;
        
        const distance = Math.hypot(
            playerCenterX - wallCenterX,
            playerCenterY - wallCenterY
        );
        
        if (distance <= breakRadius) {
            // Создаем эффект разрушения стены с разными цветами
            const colors = ['#8B4513', '#A0522D', '#CD853F', '#D2691E']; // Коричневые оттенки
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            createOptimizedParticles(
                wallCenterX,
                wallCenterY,
                randomColor,
                15 + Math.random() * 10 // Случайное количество частиц
            );
            
            // Добавляем золотые искры
            createOptimizedParticles(
                wallCenterX,
                wallCenterY,
                '#FFD700',
                5 + Math.random() * 5
            );
            
            wallsToRemove.push(i);
            wallsDestroyed++;
        }
    }
    
    // Удаляем стены
    for (const index of wallsToRemove) {
        walls.splice(index, 1);
    }
    
    // Создаем эффект разрушения в центре игрока только если разрушили стены
    if (wallsDestroyed > 0) {
        createOptimizedParticles(
            playerCenterX,
            playerCenterY,
            BOOSTER_TYPES.giant.color,
            20
        );
    }
    
    return wallsDestroyed > 0;
}

// Остановить фоновую музыку
function stopBackgroundMusic() {
    const music = document.getElementById('backgroundMusic');
    if (music) {
        music.pause();
        music.currentTime = 0;
    }
}

let lastTime = 0;
function gameLoop(currentTime) {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    // 🚀 Адаптивный контроль качества для плавности
    adaptiveQualityControl(deltaTime);

    if (gameState.mode === 'playing' && playerConfig) {
        gameState.gameTime += deltaTime;

        // 🌐 МУЛЬТИПЛЕЕР: Обновление игроков
        if (isOnlineMode) {
            // В онлайн режиме обновляем только своего игрока
            const myPlayer = onlineGameState.gameRole === 'hunter' ? hunterPlayer : preyPlayer;
            const myControls = onlineGameState.gameRole === 'hunter' ? playerConfig.hunter.controls : playerConfig.prey.controls;
            const myCharacter = onlineGameState.gameRole === 'hunter' ? playerConfig.hunter.character : playerConfig.prey.character;
            
            if (myPlayer) {
                // Получаем текущий ввод
                const currentInput = {
                    up: keys[myControls.up] || false,
                    down: keys[myControls.down] || false,
                    left: keys[myControls.left] || false,
                    right: keys[myControls.right] || false,
                    action: keys[myControls.action] || false
                };
                
                // Отправляем ввод на сервер (каждые 2 кадра для оптимизации)
                if (frameCount % 2 === 0) {
                    sendPlayerInput(currentInput);
                }
                
                // Обновляем своего игрока локально
                updatePlayer(myPlayer, myControls, deltaTime, myCharacter);
                
                // Отправляем позицию (оптимизированно)
                if (frameCount % 3 === 0) {
                    sendPlayerPosition(myPlayer);
                }
            }
        } else {
            // Локальный режим - обновляем обоих игроков как раньше
            if (hunterPlayer) {
                updatePlayer(hunterPlayer, playerConfig.hunter.controls, deltaTime, playerConfig.hunter.character);
            }
            if (preyPlayer) {
                updatePlayer(preyPlayer, playerConfig.prey.controls, deltaTime, playerConfig.prey.character);
            }
        }

        // Проверка бустеров
        if (hunterPlayer) checkBoosterCollisions(hunterPlayer);
        if (preyPlayer) checkBoosterCollisions(preyPlayer);

        // Обновление бустеров
        updateBoosters(deltaTime);

        // Более равномерное создание новых бустеров (оптимизировано)
        if (frameCount % 30 === 0) { // Проверяем только каждые 30 кадров
            const currentTimeMs = Date.now();
            const activeBoosters = boosters.filter(b => !b.collected).length;
            const gameTimeElapsed = currentTimeMs - gameState.startTime;
            const gameTimeSeconds = gameTimeElapsed / 1000;

            // Увеличиваем частоту появления бустеров после 15 секунд
            let currentMinInterval = GAME_CONFIG.minBoosterInterval;
            let currentMaxInterval = GAME_CONFIG.maxBoosterInterval;
            
            if (gameTimeSeconds > 15) {
                currentMinInterval = GAME_CONFIG.minBoosterInterval / 2;
                currentMaxInterval = GAME_CONFIG.maxBoosterInterval / 2;
            }

            if (activeBoosters < GAME_CONFIG.targetBoosterCount &&
                gameTimeElapsed > GAME_CONFIG.initialBoosterDelay &&
                currentTimeMs - GAME_CONFIG.lastBoosterSpawnTime > currentMinInterval) {

                const spawnInterval = currentMinInterval +
                    Math.random() * (currentMaxInterval - currentMinInterval);

                if (currentTimeMs - GAME_CONFIG.lastBoosterSpawnTime > spawnInterval) {
                    spawnBooster();
                    GAME_CONFIG.lastBoosterSpawnTime = currentTimeMs;
                }
            }
        }

        // 🚀 Оптимизированное обновление частиц
        updateParticlesOptimized(deltaTime);

        // Обновляем эффекты напряжения (реже)
        if (frameCount % 10 === 0) {
            updateTensionEffects();
        }

        // 🌐 МУЛЬТИПЛЕЕР: Проверка победы
        const distance = getDistanceBetweenPlayers();
        if (distance < GAME_CONFIG.catchDistance) {
            if (isOnlineMode) {
                sendGameEnd('hunter');
            } else {
                endGame('hunter');
            }
            return;
        } else if (gameState.gameTime > GAME_CONFIG.roundTime * 1000) {
            if (isOnlineMode) {
                sendGameEnd('prey');
            } else {
                endGame('prey');
            }
            return;
        }
    }

    // 🚀 Оптимизированное обновление UI (реже)
    if (frameCount % 5 === 0) {
        updateUI(currentTime);
    }
    
    render();
    requestAnimationFrame(gameLoop);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Принудительно скрываем кулдауны при загрузке
    document.querySelectorAll('.cooldown-indicator').forEach(el => {
        el.style.display = 'none';
    });
});

// 🚀 ПЕРЕКЛЮЧАТЕЛЬ УПРАВЛЕНИЯ И ДОПОЛНИТЕЛЬНЫЕ ОПТИМИЗАЦИИ

// Используем уже существующий controlState (объявлен в начале файла)

// Функция переключения управления
function toggleControls() {
    GAME_CONFIG.controlsSwapped = !GAME_CONFIG.controlsSwapped;
    
    // Визуальное обновление переключателя
    updateControlToggleUI();
    
    // 🎮 Обновляем подписи управления интерактивно
    updateControlsInfo();
    
    // Обновляем конфигурацию игроков если игра запущена
    if (playerConfig) {
        updatePlayerControlConfig();
    }
    
    console.log(`Управление ${GAME_CONFIG.controlsSwapped ? 'поменяно' : 'стандартное'}`);
}

function updateControlToggleUI() {
    const toggle = document.getElementById('controlToggle');
    
    if (GAME_CONFIG.controlsSwapped) {
        toggle.classList.add('swapped');
    } else {
        toggle.classList.remove('swapped');
    }
}

function updatePlayerControlConfig() {
    if (!playerConfig) return;
    
    // Определяем какие управления использовать
    const wasdControls = {
        up: 'KeyW',
        down: 'KeyS', 
        left: 'KeyA',
        right: 'KeyD',
        action: 'KeyE'
    };
    
    const arrowControls = {
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft', 
        right: 'ArrowRight',
        action: 'Slash'
    };
    
    if (GAME_CONFIG.controlsSwapped) {
        // Охотник получает стрелочки, добыча WASD
        playerConfig.hunter.controls = arrowControls;
        playerConfig.prey.controls = wasdControls;
    } else {
        // Стандартное: охотник WASD, добыча стрелочки
        playerConfig.hunter.controls = wasdControls;
        playerConfig.prey.controls = arrowControls;
    }
}

// 🚀 АГРЕССИВНЫЕ ОПТИМИЗАЦИИ ДЛЯ ПЛАВНОСТИ

// Переменные для FPS оптимизации
let lastFrameTime = 0;
let frameCount = 0;
let currentFPS = 0;
let performanceMode = 'auto';

// Кэши для оптимизации
let backgroundCache = null;
let staticElementsCache = null;
let lastBackgroundUpdate = 0;

// Система адаптивного качества
function adaptiveQualityControl(deltaTime) {
    frameCount++;
    
    if (frameCount % 60 === 0) { // Проверяем каждые 60 кадров
        currentFPS = Math.round(1000 / deltaTime);
        
        // Адаптивно меняем настройки качества
        if (currentFPS < 40) {
            // Снижаем качество агрессивно
            GAME_CONFIG.maxParticles = Math.max(10, GAME_CONFIG.maxParticles - 5);
            GAME_CONFIG.particleUpdateInterval = Math.min(5, GAME_CONFIG.particleUpdateInterval + 1);
            GAME_CONFIG.backgroundRedrawInterval = Math.min(8, GAME_CONFIG.backgroundRedrawInterval + 1);
            performanceMode = 'ultra-low';
        } else if (currentFPS > 80 && performanceMode === 'ultra-low') {
            // Постепенно восстанавливаем качество
            GAME_CONFIG.maxParticles = Math.min(100, GAME_CONFIG.maxParticles + 2);
            GAME_CONFIG.particleUpdateInterval = Math.max(1, GAME_CONFIG.particleUpdateInterval - 1);
            GAME_CONFIG.backgroundRedrawInterval = Math.max(2, GAME_CONFIG.backgroundRedrawInterval - 1);
            performanceMode = 'auto';
        }
    }
}

// Оптимизированная отрисовка фона с кэшированием
function drawOptimizedBackground(ctx, offsetX, offsetY) {
    const now = Date.now();
    
    // Используем кэш фона если недавно обновляли
    if (backgroundCache && (now - lastBackgroundUpdate) < (1000 / GAME_CONFIG.backgroundRedrawInterval)) {
        ctx.drawImage(backgroundCache, 0, 0);
        return;
    }
    
    // Создаем кэш если его нет
    if (!backgroundCache) {
        backgroundCache = document.createElement('canvas');
        backgroundCache.width = GAME_CONFIG.canvasWidth;
        backgroundCache.height = GAME_CONFIG.canvasHeight;
    }
    
    const bgCtx = backgroundCache.getContext('2d');
    
    // Рисуем фон в кэш
    const gradient = bgCtx.createRadialGradient(
        GAME_CONFIG.canvasWidth / 2, GAME_CONFIG.canvasHeight / 2, 0,
        GAME_CONFIG.canvasWidth / 2, GAME_CONFIG.canvasHeight / 2, GAME_CONFIG.canvasWidth
    );
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f0f23');
    
    bgCtx.fillStyle = gradient;
    bgCtx.fillRect(0, 0, GAME_CONFIG.canvasWidth, GAME_CONFIG.canvasHeight);
    
    // Применяем кэш
    ctx.drawImage(backgroundCache, 0, 0);
    lastBackgroundUpdate = now;
}

// Оптимизированное обновление частиц
function updateParticlesOptimized(deltaTime) {
    let activeCount = 0;
    
    // Обновляем только каждую N-ю частицу для экономии CPU
    for (let i = particles.length - 1; i >= 0; i--) {
        if (i % GAME_CONFIG.particleUpdateInterval === 0 || activeCount < 10) {
            const particle = particles[i];
            particle.update(deltaTime);
            
            if (particle.life <= 0) {
                particles.splice(i, 1);
            } else {
                activeCount++;
            }
        }
    }
    
    // Ограничиваем общее количество частиц
    if (particles.length > GAME_CONFIG.maxParticles) {
        particles.splice(GAME_CONFIG.maxParticles);
    }
}

// Счетчик FPS для мониторинга
function drawFPSCounter() {
    if (performanceMode === 'ultra-low') return; // Не рисуем в ультра-режиме
    
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(5, 5, 80, 25);
    
    const color = currentFPS > 50 ? '#00ff88' : currentFPS > 30 ? '#ffaa00' : '#ff4757';
    ctx.fillStyle = color;
    ctx.font = '12px monospace';
    ctx.fillText(`FPS: ${currentFPS}`, 10, 20);
    ctx.restore();
}

// 🎨 СИСТЕМА НАСТРОЕК ГРАФИКИ

function setGraphicsLevel(level) {
    if (!GRAPHICS_PRESETS[level]) return;
    
    const preset = GRAPHICS_PRESETS[level];
    GAME_CONFIG.graphicsLevel = level;
    
    // Применяем настройки из пресета
    GAME_CONFIG.targetFPS = preset.targetFPS;
    GAME_CONFIG.maxParticles = preset.maxParticles;
    GAME_CONFIG.particleUpdateInterval = preset.particleUpdateInterval;
    GAME_CONFIG.backgroundRedrawInterval = preset.backgroundRedrawInterval;
    
    // 🚀 СРАЗУ ПРИМЕНЯЕМ ИЗМЕНЕНИЯ К ИГРЕ
    applyGraphicsChanges(level);
    
    // Обновляем UI
    updateGraphicsToggleUI();
    
    console.log(`Качество графики: ${level} (${preset.maxParticles} частиц, ${preset.targetFPS} FPS)`);
}

function applyGraphicsChanges(level) {
    const preset = GRAPHICS_PRESETS[level];
    
    // 🖥️ ИЗМЕНЯЕМ РАЗРЕШЕНИЕ CANVAS
    updateCanvasResolution(preset.resolutionScale);
    
    // Ограничиваем количество частиц немедленно
    if (particles.length > preset.maxParticles) {
        particles.splice(preset.maxParticles);
    }
    
    // Сбрасываем кэш фона для немедленного обновления
    backgroundCache = null;
    lastBackgroundUpdate = 0;
    
    // Добавляем визуальный эффект переключения
    if (gameState.mode === 'playing') {
        createGraphicsChangeEffect(level);
    }
}

function updateCanvasResolution(scale) {
    // Вычисляем новые ФИЗИЧЕСКИЕ размеры canvas (для рендера)
    const renderWidth = Math.floor(GAME_CONFIG.baseCanvasWidth * scale);
    const renderHeight = Math.floor(GAME_CONFIG.baseCanvasHeight * scale);
    
    // Обновляем ФИЗИЧЕСКИЕ размеры canvas (влияет на производительность)
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    
    // Миникарта ВСЕГДА остается одного размера
    minimap.width = 234;
    minimap.height = 156;
    
    // ЛОГИЧЕСКИЕ размеры остаются прежними (размер видимой области)
    // Это значит что игрок видит ту же область карты, но в меньшем разрешении
    GAME_CONFIG.canvasWidth = GAME_CONFIG.baseCanvasWidth;  // Всегда полный размер!
    GAME_CONFIG.canvasHeight = GAME_CONFIG.baseCanvasHeight; // Всегда полный размер!
    
    // Масштабируем контекст для соответствия логических и физических размеров
    const scaleX = renderWidth / GAME_CONFIG.baseCanvasWidth;
    const scaleY = renderHeight / GAME_CONFIG.baseCanvasHeight;
    
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    // Миникарта остается без масштабирования контекста
    minimapCtx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Настраиваем сглаживание для лучшего качества при масштабировании
    if (scale < 1.0) {
        ctx.imageSmoothingEnabled = false; // Пиксельный стиль для низкого разрешения
        canvas.classList.add('low-res');
    } else {
        ctx.imageSmoothingEnabled = true;  // Сглаживание для высокого разрешения
        canvas.classList.remove('low-res');
    }
    
    // Миникарта всегда с хорошим качеством
    minimapCtx.imageSmoothingEnabled = true;
    minimap.classList.remove('low-res');
    
    console.log(`Разрешение рендера: ${renderWidth}x${renderHeight} (${Math.round(scale * 100)}%), область просмотра: ${GAME_CONFIG.canvasWidth}x${GAME_CONFIG.canvasHeight}`);
}

function createGraphicsChangeEffect(level) {
    // Создаем эффект смены качества графики
    const colors = {
        'LOW': '#ff6b6b',
        'MED': '#ffd93d', 
        'HIGH': '#6bcf7f'
    };
    
    const color = colors[level] || '#ffffff';
    
    // Показываем уведомление кратковременно
    showGraphicsNotification(level, color);
    
    // Добавляем визуальный эффект частицами при переключении
    if (level === 'HIGH' && hunterPlayer && preyPlayer) {
        // Много красивых частиц для демонстрации HIGH режима
        createOptimizedParticles(hunterPlayer.x, hunterPlayer.y, color, 30);
        createOptimizedParticles(preyPlayer.x, preyPlayer.y, color, 30);
    } else if (level === 'LOW') {
        // Мало частиц для демонстрации LOW режима
        if (hunterPlayer && preyPlayer) {
            createOptimizedParticles(hunterPlayer.x, hunterPlayer.y, color, 5);
            createOptimizedParticles(preyPlayer.x, preyPlayer.y, color, 5);
        }
    } else if (level === 'MED') {
        // Среднее количество частиц
        if (hunterPlayer && preyPlayer) {
            createOptimizedParticles(hunterPlayer.x, hunterPlayer.y, color, 15);
            createOptimizedParticles(preyPlayer.x, preyPlayer.y, color, 15);
        }
    }
}

function updateGraphicsToggleUI() {
    const options = document.querySelectorAll('.graphics-option');
    options.forEach(option => {
        option.classList.remove('active');
        if (option.dataset.level === GAME_CONFIG.graphicsLevel) {
            option.classList.add('active');
        }
    });
}

function initGraphicsToggle() {
    const toggle = document.getElementById('graphicsToggle');
    if (!toggle) return;
    
    toggle.addEventListener('click', (e) => {
        if (e.target.classList.contains('graphics-option')) {
            const level = e.target.dataset.level;
            setGraphicsLevel(level);
        }
    });
    
    // Устанавливаем начальный уровень
    setGraphicsLevel('MED');
    
    // Инициализируем базовое разрешение
    updateCanvasResolution(GRAPHICS_PRESETS.MED.resolutionScale);
}

let graphicsNotification = {
    visible: false,
    text: '',
    color: '#ffffff',
    startTime: 0,
    duration: 2000
};

function showGraphicsNotification(level, color) {
    const preset = GRAPHICS_PRESETS[level];
    const resolutionText = `${Math.round(preset.resolutionScale * 100)}%`;
    
    graphicsNotification.visible = true;
    graphicsNotification.text = `${level} (${resolutionText})`;
    graphicsNotification.color = color;
    graphicsNotification.startTime = Date.now();
    
    // Автоматически скрываем через 2 секунды
    setTimeout(() => {
        graphicsNotification.visible = false;
    }, graphicsNotification.duration);
}

function drawGraphicsNotification() {
    if (!graphicsNotification.visible) return;
    
    const elapsed = Date.now() - graphicsNotification.startTime;
    const progress = elapsed / graphicsNotification.duration;
    const alpha = Math.max(0, 1 - progress);
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(GAME_CONFIG.canvasWidth - 180, 80, 160, 40);
    
    ctx.fillStyle = graphicsNotification.color;
    ctx.font = '16px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText(graphicsNotification.text, GAME_CONFIG.canvasWidth - 100, 105);
    ctx.restore();
}

// Запуск игрового цикла
requestAnimationFrame(gameLoop);

function updateUI(currentTime = 0) {
    // Обновление таймера
    const elapsed = Math.floor(gameState.gameTime / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const totalMinutes = Math.floor(GAME_CONFIG.roundTime / 60);
    const totalSeconds = GAME_CONFIG.roundTime % 60;
    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const timer = document.getElementById('gameTimer');
    if (timer) timer.textContent = timeString;

    // Обновление счета
    const hunterScore = document.getElementById('punkScore');
    const preyScore = document.getElementById('businessmanScore');
    if (hunterScore) hunterScore.textContent = gameState.scores.hunter || 0;
    if (preyScore) preyScore.textContent = gameState.scores.prey || 0;

    // Кулдауны (если есть)
    const punkCooldownBar = document.getElementById('punkCooldown');
    const businessmanCooldownBar = document.getElementById('businessmanCooldown');
    if (punkCooldownBar && hunterPlayer && playerConfig && playerConfig.hunter) {
        const hunterMaxCooldown = getCharacterCooldown(playerConfig.hunter.character);
        const hunterCooldownPercent = Math.max(0, (hunterMaxCooldown - hunterPlayer.ghostCooldown) / hunterMaxCooldown * 100);
        punkCooldownBar.style.width = `${hunterCooldownPercent}%`;
    }
    if (businessmanCooldownBar && preyPlayer && playerConfig && playerConfig.prey) {
        const preyMaxCooldown = getCharacterCooldown(playerConfig.prey.character);
        const preyCooldownPercent = Math.max(0, (preyMaxCooldown - preyPlayer.ghostCooldown) / preyMaxCooldown * 100);
        businessmanCooldownBar.style.width = `${preyCooldownPercent}%`;
    }

    // Обновляем названия способностей в индикаторах кулдауна
    updateCooldownLabels();


}



// Функция для получения кулдауна персонажа
function getCharacterCooldown(characterType) {
    switch(characterType) {
        case 'punk': // Саня - Призрак
            return 8000; // 8 секунд
        case 'businessman': // Леха - Телепортация
            return 5000; // 5 секунд
        case 'kok': // Степа - Ускорение
            return 5000; // 5 секунд
        case 'maks': // Макс - Гигант
            return 8000; // 8 секунд
        default:
            return 5000;
    }
}

function updateCooldownLabels() {
    // Обновляем название способности охотника
    const hunterLabel = document.querySelector('.hunter-cooldown-indicator .cooldown-label');
    if (hunterLabel && playerConfig && playerConfig.hunter) {
        let abilityName = '';
        const hunterCharacter = playerConfig.hunter.character;
        
        switch(hunterCharacter) {
            case 'punk':
                abilityName = 'Призрак';
                break;
            case 'businessman':
                abilityName = 'Телепорт';
                break;
            case 'kok':
                abilityName = 'Ускорение';
                break;
            case 'maks':
                abilityName = 'Гигант';
                break;
        }
        
        hunterLabel.textContent = `🎯 Охотник: ${abilityName} (E)`;
    }

    // Обновляем название способности добычи
    const preyLabel = document.querySelector('.prey-cooldown-indicator .cooldown-label');
    if (preyLabel && playerConfig && playerConfig.prey) {
        let abilityName = '';
        const preyCharacter = playerConfig.prey.character;
        
        switch(preyCharacter) {
            case 'punk':
                abilityName = 'Призрак';
                break;
            case 'businessman':
                abilityName = 'Телепорт';
                break;
            case 'kok':
                abilityName = 'Ускорение';
                break;
            case 'maks':
                abilityName = 'Гигант';
                break;
        }
        
        preyLabel.textContent = `🏃‍♂️ Добыча: ${abilityName} (/)`;
    }
}

function updateTensionEffects() {
    // Рассчитываем напряжение по расстоянию между игроками
    const distance = getDistanceBetweenPlayers();
    const maxDistance = Math.sqrt(GAME_CONFIG.worldWidth * GAME_CONFIG.worldWidth + GAME_CONFIG.worldHeight * GAME_CONFIG.worldHeight);
    const tension = Math.max(0, 1 - (distance / (maxDistance / 3))); // Чем ближе, тем больше напряжение

    // Обновляем полосу напряжения
    const tensionFill = document.getElementById('tensionFill');
    const tensionIndicator = document.getElementById('tensionIndicator');
    if (tensionFill) tensionFill.style.width = `${tension * 100}%`;

    // Визуальные эффекты при высоком напряжении
    if (tensionIndicator) {
        if (tension > 0.7) {
            tensionIndicator.classList.add('tension-high');
        } else {
            tensionIndicator.classList.remove('tension-high');
        }
    }
}

// Обновляем позиции игроков при изменении размеров мира
function updatePlayerPositions() {
    const worldScale = Math.min(GAME_CONFIG.canvasWidth / 1680, GAME_CONFIG.canvasHeight / 900);
    
    // Обновляем размеры и позиции всех игроков
    Object.keys(players).forEach(key => {
        const player = players[key];
        
        // Масштабируем размеры игрока
        player.width = player.originalWidth * worldScale;
        player.height = player.originalHeight * worldScale;
        
        // Обновляем скорость и ускорение на основе базовых значений
        player.maxSpeed = player.baseMaxSpeed * worldScale;
        player.acceleration = player.baseAcceleration * worldScale;
        
        // Обновляем позиции относительно границ мира
        if (key === 'businessman' || key === 'maks') {
            player.x = GAME_CONFIG.worldWidth - 150 * worldScale;
            player.y = GAME_CONFIG.worldHeight - 150 * worldScale;
            player.lastSafeX = player.x;
            player.lastSafeY = player.y;
        } else {
            player.x = 100 * worldScale;
            player.y = 100 * worldScale;
            player.lastSafeX = player.x;
            player.lastSafeY = player.y;
        }
    });
}

// Инициализация canvas с адаптивностью
function initializeCanvas() {
    const gameContainer = document.querySelector('.game-container');
    const containerRect = gameContainer.getBoundingClientRect();
    
    // Определяем оптимальные размеры canvas
    const maxWidth = Math.min(1680, containerRect.width * 0.95);
    const maxHeight = Math.min(900, containerRect.height * 0.95);
    
    // Сохраняем пропорции 1680:900 (примерно 1.87:1)
    const aspectRatio = 1680 / 900;
    let canvasWidth, canvasHeight;
    
    if (maxWidth / maxHeight > aspectRatio) {
        canvasHeight = maxHeight;
        canvasWidth = canvasHeight * aspectRatio;
    } else {
        canvasWidth = maxWidth;
        canvasHeight = canvasWidth / aspectRatio;
    }
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    // Обновляем конфигурацию игры
    GAME_CONFIG.canvasWidth = canvasWidth;
    GAME_CONFIG.canvasHeight = canvasHeight;
    
    // Адаптируем размеры мира под canvas (сохраняем пропорции)
    const worldScale = Math.min(canvasWidth / 1680, canvasHeight / 900);
    GAME_CONFIG.worldWidth = 2340 * worldScale;
    GAME_CONFIG.worldHeight = 1175 * worldScale;
    GAME_CONFIG.cellSize = 50 * worldScale;
    GAME_CONFIG.catchDistance = 45 * worldScale;
    
    // Обновляем размеры миникарты
    const minimapScale = Math.min(canvasWidth / 1680, 1);
    minimap.width = 234 * minimapScale;
    minimap.height = 156 * minimapScale;
    
    // Обновляем позиции игроков
    updatePlayerPositions();
    
    console.log(`Canvas размер: ${canvasWidth}x${canvasHeight}, Мир: ${GAME_CONFIG.worldWidth}x${GAME_CONFIG.worldHeight}`);
}

// ===============================
// 🌐 МУЛЬТИПЛЕЕР ФУНКЦИИ
// ===============================

// Функции интерфейса мультиплеера
function showMultiplayerMenu() {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('multiplayerMenu').classList.add('active');
    initSocket();
}

function hideMultiplayerMenu() {
    document.getElementById('multiplayerMenu').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
}

function createRoom() {
    if (!socket || !socket.connected) {
        alert('Не подключен к серверу');
        return;
    }
    
    socket.emit('create-room');
    updateConnectionStatus('connecting', 'Создание комнаты...');
}

function joinRoom() {
    const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (!roomCode) {
        alert('Введите код комнаты');
        return;
    }
    
    if (!socket || !socket.connected) {
        alert('Не подключен к серверу');
        return;
    }
    
    socket.emit('join-room', roomCode);
    updateConnectionStatus('connecting', 'Присоединение к комнате...');
}

function showLobby() {
    document.getElementById('multiplayerMenu').classList.remove('active');
    document.getElementById('lobbyScreen').classList.add('active');
}

function leaveLobby() {
    if (socket) {
        socket.emit('leave-room', onlineGameState.roomCode);
    }
    
    // Сброс состояния
    isOnlineMode = false;
    onlineGameState = {
        roomCode: null,
        playerId: null,
        playerRole: null,
        gameRole: null,
        myCharacter: null,
        opponentCharacter: null,
        isConnected: onlineGameState.isConnected,
        opponentPosition: { x: 0, y: 0, angle: 0 },
        lastSentPosition: { x: 0, y: 0, angle: 0 },
        inputBuffer: []
    };
    
    document.getElementById('lobbyScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
}

function selectOnlineCharacter(character) {
    if (!socket || !onlineGameState.roomCode) return;
    
    onlineGameState.myCharacter = character;
    
    socket.emit('select-character', {
        roomCode: onlineGameState.roomCode,
        character: character
    });
    
    // Визуально выделяем выбранного персонажа
    document.querySelectorAll('#lobbyCharacterSelection .character-option').forEach(el => {
        el.classList.remove('selected');
    });
    document.querySelector(`#lobbyCharacterSelection .character-option.${character}`).classList.add('selected');
}

function updateConnectionStatus(status, message) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;
    
    statusEl.className = 'connection-status';
    statusEl.classList.add(`status-${status}`);
    statusEl.textContent = message;
}

function updateRoomCode(roomCode) {
    const displayEl = document.getElementById('roomCodeDisplay');
    if (displayEl) {
        displayEl.textContent = `Код комнаты: ${roomCode}`;
    }
}

function updatePlayersInLobby(players) {
    const hostCard = document.getElementById('hostCard');
    const guestCard = document.getElementById('guestCard');
    
    const host = players.find(p => p.role === 'host');
    const guest = players.find(p => p.role === 'guest');
    
    if (host) {
        document.getElementById('hostInfo').textContent = host.ready ? 'Готов' : 'Выбирает персонажа';
        document.getElementById('hostCharacter').textContent = host.character ? getCharacterName(host.character) : '';
        hostCard.classList.toggle('ready', host.ready);
    }
    
    if (guest) {
        document.getElementById('guestInfo').textContent = guest.ready ? 'Готов' : 'Выбирает персонажа';
        document.getElementById('guestCharacter').textContent = guest.character ? getCharacterName(guest.character) : '';
        guestCard.classList.toggle('ready', guest.ready);
        guestCard.classList.remove('empty');
    } else {
        document.getElementById('guestInfo').textContent = 'Ожидание подключения...';
        document.getElementById('guestCharacter').textContent = '';
        guestCard.classList.remove('ready');
        guestCard.classList.add('empty');
    }
    
    // Обновляем статус лобби
    const statusEl = document.getElementById('lobbyStatus');
    if (statusEl) {
        if (players.length === 2 && players.every(p => p.ready)) {
            statusEl.textContent = 'Запуск игры...';
            statusEl.className = 'connection-status status-connected';
        } else if (players.length === 2) {
            statusEl.textContent = 'Ожидание готовности игроков...';
            statusEl.className = 'connection-status status-connecting';
        } else {
            statusEl.textContent = 'Ожидание второго игрока...';
            statusEl.className = 'connection-status status-connecting';
        }
    }
}

function getCharacterName(character) {
    const names = {
        'punk': 'Панк Саня',
        'businessman': 'Бизнесмен Леха',  
        'kok': 'Степа Кок',
        'maks': 'Макс Здоровый'
    };
    return names[character] || character;
}

// Функции игровой синхронизации
function startOnlineGame() {
    // Скрываем лобби
    document.getElementById('lobbyScreen').classList.remove('active');
    
    // Настраиваем персонажей для онлайн игры
    playerConfig = getOnlinePlayerConfig();
    
    // Запускаем игру
    gameState.mode = 'playing';
    gameState.startTime = Date.now();
    gameState.roundNumber = 1;
    gameState.scores = { hunter: 0, prey: 0 };
    
    // Генерируем лабиринт
    generateMaze();
    
    // Настраиваем игроков
    setupOnlinePlayers();
    
    // Запускаем фоновую музыку
    playBackgroundMusic();
    
    // Скрываем стартовый экран
    hideStartScreen();
    
    console.log(`🎮 Онлайн игра началась! Роль: ${onlineGameState.gameRole}, Персонаж: ${onlineGameState.myCharacter}`);
}

function getOnlinePlayerConfig() {
    // Создаем конфигурацию на основе ролей в онлайн игре
    const config = {
        hunter: {
            character: characterSelection.hunter,
            controls: onlineGameState.gameRole === 'hunter' ? getMyControls() : getOpponentControls()
        },
        prey: {
            character: characterSelection.prey,
            controls: onlineGameState.gameRole === 'prey' ? getMyControls() : getOpponentControls()
        }
    };
    
    return config;
}

function getMyControls() {
    // Возвращаем управление для текущего игрока
    return {
        up: GAME_CONFIG.controlsSwapped ? 'ArrowUp' : 'KeyW',
        down: GAME_CONFIG.controlsSwapped ? 'ArrowDown' : 'KeyS', 
        left: GAME_CONFIG.controlsSwapped ? 'ArrowLeft' : 'KeyA',
        right: GAME_CONFIG.controlsSwapped ? 'ArrowRight' : 'KeyD',
        action: GAME_CONFIG.controlsSwapped ? 'Slash' : 'KeyE'
    };
}

function getOpponentControls() {
    // Для противника создаем фиктивные управление (они управляются по сети)
    return {
        up: null, down: null, left: null, right: null, action: null
    };
}

function setupOnlinePlayers() {
    // Получаем случайные позиции спавна
    function getRandomSpawnPoint() {
        let attempts = 0;
        while (attempts < 100) {
            const x = Math.random() * (GAME_CONFIG.worldWidth - 200) + 100;
            const y = Math.random() * (GAME_CONFIG.worldHeight - 200) + 100;
            
            const testPlayer = { x, y, width: 35, height: 45 };
            if (!checkWallCollision(testPlayer, x, y)) {
                return { x, y };
            }
            attempts++;
        }
        return { x: 100, y: 100 }; // Fallback
    }
    
    const hunterSpawn = getRandomSpawnPoint();
    const preySpawn = getRandomSpawnPoint();
    
    // Настраиваем игроков в зависимости от роли
    if (onlineGameState.gameRole === 'hunter') {
        // Я охотник
        hunterPlayer = createPlayerCopy(players[onlineGameState.myCharacter], onlineGameState.myCharacter);
        hunterPlayer.x = hunterSpawn.x;
        hunterPlayer.y = hunterSpawn.y;
        
        // Противник - добыча
        preyPlayer = createPlayerCopy(players[onlineGameState.opponentCharacter], onlineGameState.opponentCharacter);
        preyPlayer.x = preySpawn.x;
        preyPlayer.y = preySpawn.y;
    } else {
        // Я добыча
        preyPlayer = createPlayerCopy(players[onlineGameState.myCharacter], onlineGameState.myCharacter);
        preyPlayer.x = preySpawn.x;
        preyPlayer.y = preySpawn.y;
        
        // Противник - охотник
        hunterPlayer = createPlayerCopy(players[onlineGameState.opponentCharacter], onlineGameState.opponentCharacter);
        hunterPlayer.x = hunterSpawn.x;
        hunterPlayer.y = hunterSpawn.y;
    }
}

function updatePlayerFromInput(player, controls, characterType) {
    // Применяем ввод противника к его персонажу
    const fakeKeys = {};
    if (controls.up) fakeKeys['ArrowUp'] = true;
    if (controls.down) fakeKeys['ArrowDown'] = true;  
    if (controls.left) fakeKeys['ArrowLeft'] = true;
    if (controls.right) fakeKeys['ArrowRight'] = true;
    if (controls.action) fakeKeys['Slash'] = true;
    
    // Обновляем игрока с полученным вводом
    updatePlayer(player, { 
        up: controls.up,
        down: controls.down,
        left: controls.left, 
        right: controls.right,
        action: controls.action
    }, 16.67, characterType);
}

function sendPlayerInput(controls) {
    if (!socket || !isOnlineMode || !onlineGameState.roomCode) return;
    
    socket.emit('player-input', {
        roomCode: onlineGameState.roomCode,
        controls: controls,
        timestamp: Date.now()
    });
}

function sendPlayerPosition(player) {
    if (!socket || !isOnlineMode || !onlineGameState.roomCode) return;
    
    // Отправляем позицию только если она значительно изменилась
    const lastPos = onlineGameState.lastSentPosition;
    const threshold = 5; // пикселей
    
    if (Math.abs(player.x - lastPos.x) > threshold || 
        Math.abs(player.y - lastPos.y) > threshold ||
        Math.abs(player.angle - lastPos.angle) > 0.1) {
        
        socket.emit('player-position', {
            roomCode: onlineGameState.roomCode,
            x: player.x,
            y: player.y,
            angle: player.angle,
            timestamp: Date.now()
        });
        
        onlineGameState.lastSentPosition = {
            x: player.x,
            y: player.y, 
            angle: player.angle
        };
    }
}

function sendGameEnd(winner) {
    if (!socket || !isOnlineMode || !onlineGameState.roomCode) return;
    
    socket.emit('game-end', {
        roomCode: onlineGameState.roomCode,
        winner: winner
    });
}

function sendBoosterCollected(boosterId) {
    if (!socket || !isOnlineMode || !onlineGameState.roomCode) return;
    
    socket.emit('booster-collected', {
        roomCode: onlineGameState.roomCode,
        boosterId: boosterId,
        timestamp: Date.now()
    });
}

function hideStartScreen() {
    const startScreen = document.getElementById('startScreen');
    if (startScreen) {
        startScreen.style.display = 'none';
    }
    
    // Убираем класс start-screen-active для показа кулдаунов
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
        gameContainer.classList.remove('start-screen-active');
        gameContainer.classList.add('game-active');
    }
}

// Инициализация при загрузке
window.addEventListener('load', () => {
    // Инициализируем переключатель управления
    updateControlToggleUI();
    
    // Применяем начальные оптимизации
    console.log('🚀 Оптимизации производительности активированы');
    
    // Инициализируем Socket.IO при загрузке
    console.log('🌐 Инициализация мультиплеера...');
});
