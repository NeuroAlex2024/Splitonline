const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = require('http').createServer(app);

// Настройка CORS
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Socket.IO сервер
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Игровые комнаты
const gameRooms = new Map();

// Генерация кода комнаты
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Создание новой комнаты
function createRoom(hostSocketId) {
    const roomCode = generateRoomCode();
    const room = {
        code: roomCode,
        players: [
            { socketId: hostSocketId, role: 'host', ready: false, character: null }
        ],
        gameState: {
            mode: 'lobby', // lobby, playing, ended
            startTime: 0,
            roundNumber: 1,
            scores: { hunter: 0, prey: 0 },
            playerPositions: {},
            boosters: [],
            gameTime: 0
        },
        lastUpdate: Date.now()
    };
    
    gameRooms.set(roomCode, room);
    console.log(`🏠 Комната ${roomCode} создана хостом ${hostSocketId}`);
    return room;
}

// Socket.IO события
io.on('connection', (socket) => {
    console.log(`👤 Игрок подключился: ${socket.id}`);
    
    // Создание комнаты
    socket.on('create-room', () => {
        const room = createRoom(socket.id);
        socket.join(room.code);
        socket.emit('room-created', {
            roomCode: room.code,
            role: 'host'
        });
        console.log(`🎮 Игрок ${socket.id} создал комнату ${room.code}`);
    });
    
    // Присоединение к комнате
    socket.on('join-room', (roomCode) => {
        const room = gameRooms.get(roomCode.toUpperCase());
        
        if (!room) {
            socket.emit('error', { message: 'Комната не найдена' });
            return;
        }
        
        if (room.players.length >= 2) {
            socket.emit('error', { message: 'Комната полная' });
            return;
        }
        
        if (room.gameState.mode !== 'lobby') {
            socket.emit('error', { message: 'Игра уже началась' });
            return;
        }
        
        // Добавляем игрока в комнату
        room.players.push({
            socketId: socket.id,
            role: 'guest',
            ready: false,
            character: null
        });
        
        socket.join(roomCode.toUpperCase());
        
        // Уведомляем всех в комнате
        io.to(roomCode.toUpperCase()).emit('player-joined', {
            players: room.players.map(p => ({
                socketId: p.socketId,
                role: p.role,
                ready: p.ready,
                character: p.character
            }))
        });
        
        socket.emit('room-joined', {
            roomCode: roomCode.toUpperCase(),
            role: 'guest'
        });
        
        console.log(`🎮 Игрок ${socket.id} присоединился к комнате ${roomCode.toUpperCase()}`);
    });
    
    // Выбор персонажа
    socket.on('select-character', (data) => {
        const room = gameRooms.get(data.roomCode);
        if (!room) return;
        
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
            player.character = data.character;
            player.ready = true;
            
            // Уведомляем всех в комнате
            io.to(data.roomCode).emit('character-selected', {
                socketId: socket.id,
                character: data.character,
                players: room.players.map(p => ({
                    socketId: p.socketId,
                    role: p.role,
                    ready: p.ready,
                    character: p.character
                }))
            });
            
            // Проверяем, готовы ли все игроки
            if (room.players.length === 2 && room.players.every(p => p.ready)) {
                // Определяем роли
                const roles = ['hunter', 'prey'];
                const shuffledRoles = roles.sort(() => Math.random() - 0.5);
                
                room.players.forEach((player, index) => {
                    player.gameRole = shuffledRoles[index];
                });
                
                room.gameState.mode = 'playing';
                room.gameState.startTime = Date.now();
                
                io.to(data.roomCode).emit('game-start', {
                    players: room.players.map(p => ({
                        socketId: p.socketId,
                        character: p.character,
                        gameRole: p.gameRole
                    }))
                });
                
                console.log(`🚀 Игра началась в комнате ${data.roomCode}`);
            }
        }
    });
    
    // Движение игрока
    socket.on('player-input', (data) => {
        const room = gameRooms.get(data.roomCode);
        if (!room || room.gameState.mode !== 'playing') return;
        
        // Пересылаем ввод другому игроку
        socket.to(data.roomCode).emit('opponent-input', {
            socketId: socket.id,
            controls: data.controls,
            timestamp: data.timestamp
        });
    });
    
    // Обновление позиции игрока
    socket.on('player-position', (data) => {
        const room = gameRooms.get(data.roomCode);
        if (!room || room.gameState.mode !== 'playing') return;
        
        room.gameState.playerPositions[socket.id] = {
            x: data.x,
            y: data.y,
            angle: data.angle,
            timestamp: data.timestamp
        };
        
        // Отправляем позицию другому игроку
        socket.to(data.roomCode).emit('opponent-position', {
            socketId: socket.id,
            x: data.x,
            y: data.y,
            angle: data.angle,
            timestamp: data.timestamp
        });
    });
    
    // Сбор бустера
    socket.on('booster-collected', (data) => {
        const room = gameRooms.get(data.roomCode);
        if (!room) return;
        
        // Синхронизируем сбор бустера между игроками
        io.to(data.roomCode).emit('booster-sync-collected', {
            boosterId: data.boosterId,
            collectorId: socket.id,
            timestamp: data.timestamp
        });
    });
    
    // Завершение игры
    socket.on('game-end', (data) => {
        const room = gameRooms.get(data.roomCode);
        if (!room) return;
        
        room.gameState.mode = 'ended';
        
        // Обновляем счет
        if (data.winner === 'hunter') {
            room.gameState.scores.hunter++;
        } else {
            room.gameState.scores.prey++;
        }
        
        io.to(data.roomCode).emit('game-ended', {
            winner: data.winner,
            scores: room.gameState.scores,
            roundNumber: room.gameState.roundNumber
        });
        
        // Проверяем, закончена ли серия
        if (room.gameState.roundNumber >= 5) {
            // Определяем общего победителя
            const finalWinner = room.gameState.scores.hunter > room.gameState.scores.prey ? 'hunter' : 'prey';
            
            setTimeout(() => {
                io.to(data.roomCode).emit('series-ended', {
                    finalWinner: finalWinner,
                    finalScores: room.gameState.scores
                });
            }, 3000);
        } else {
            // Переход к следующему раунду
            setTimeout(() => {
                room.gameState.roundNumber++;
                room.gameState.mode = 'playing';
                room.gameState.startTime = Date.now();
                
                io.to(data.roomCode).emit('next-round', {
                    roundNumber: room.gameState.roundNumber,
                    scores: room.gameState.scores
                });
            }, 5000);
        }
        
        console.log(`🏆 Игра завершена в комнате ${data.roomCode}, победитель: ${data.winner}`);
    });
    
    // Отключение игрока
    socket.on('disconnect', () => {
        console.log(`👋 Игрок отключился: ${socket.id}`);
        
        // Находим комнату игрока и уведомляем других
        for (const [roomCode, room] of gameRooms.entries()) {
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                
                if (room.players.length === 0) {
                    // Удаляем пустую комнату
                    gameRooms.delete(roomCode);
                    console.log(`🗑️ Комната ${roomCode} удалена (пустая)`);
                } else {
                    // Уведомляем оставшихся игроков
                    io.to(roomCode).emit('player-disconnected', {
                        disconnectedId: socket.id,
                        remainingPlayers: room.players.length
                    });
                }
                break;
            }
        }
    });
});

// Очистка неактивных комнат каждые 5 минут
setInterval(() => {
    const now = Date.now();
    for (const [roomCode, room] of gameRooms.entries()) {
        if (now - room.lastUpdate > 300000) { // 5 минут
            gameRooms.delete(roomCode);
            console.log(`🧹 Удалена неактивная комната: ${roomCode}`);
        }
    }
}, 300000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Split6 сервер запущен на порту ${PORT}`);
    console.log(`🌐 Доступен по адресу: http://localhost:${PORT}`);
}); 