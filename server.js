const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();

app.use(express.static(__dirname + "/public"));

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        game: "UNO NO MERCY",
        version: "4.0.0"
    });
});

const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

const rooms = new Map();

const COLORS = [
    "red",
    "yellow",
    "green",
    "blue"
];

function createRoomCode() {

    let code;

    do {
        code = Math.random()
            .toString(36)
            .substring(2, 7)
            .toUpperCase();

    } while (rooms.has(code));

    return code;
}

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room) {

    const top =
        room.discard[
            room.discard.length - 1
        ] || null;

    room.players.forEach(player => {

        send(player.ws, {

            type: "state",

            room: room.code,

            started: room.started,

            hostId: room.hostId,

            currentPlayer: room.currentPlayer,

            direction: room.direction,

            topCard: top,

            winner: room.winner || null,

            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                count: p.hand.length
            })),

            you: player.id,

            hand: player.hand

        });

    });
}

function createDeck() {

    const deck = [];

    let id = 1;

    for (const color of COLORS) {

        deck.push({
            id: String(id++),
            color,
            value: "0"
        });

        for (let n = 1; n <= 9; n++) {

            deck.push({
                id: String(id++),
                color,
                value: String(n)
            });

            deck.push({
                id: String(id++),
                color,
                value: String(n)
            });
        }

        for (
            const value of [
                "skip",
                "reverse",
                "draw2"
            ]
        ) {

            deck.push({
                id: String(id++),
                color,
                value
            });

            deck.push({
                id: String(id++),
                color,
                value
            });
        }
    }

    for (let i = 0; i < 4; i++) {

        deck.push({
            id: String(id++),
            color: "wild",
            value: "wild"
        });

        deck.push({
            id: String(id++),
            color: "wild",
            value: "draw4"
        });
    }

    return deck;
}

function shuffle(deck) {

    for (
        let i = deck.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(
                Math.random() * (i + 1)
            );

        [
            deck[i],
            deck[j]
        ] = [
            deck[j],
            deck[i]
        ];
    }
}

function refillDeck(room) {

    if (
        room.deck.length === 0 &&
        room.discard.length > 1
    ) {

        const top =
            room.discard.pop();

        room.deck =
            room.discard.splice(0);

        shuffle(room.deck);

        room.discard = [top];
    }
}

function startGame(room) {

    room.deck = createDeck();

    shuffle(room.deck);

    room.discard = [];

    room.started = true;

    room.winner = null;

    room.direction = 1;

    room.currentPlayer = 0;

    room.players.forEach(player => {

        player.hand = [];

        for (let i = 0; i < 7; i++) {

            player.hand.push(
                room.deck.pop()
            );
        }
    });

    let first;

    do {

        first =
            room.deck.pop();

        if (
            first &&
            (
                first.color === "wild" ||
                first.value === "draw4"
            )
        ) {

            room.deck.unshift(first);
            first = null;
        }

    } while (!first);

    room.discard.push(first);
}

function nextPlayer(room, amount = 1) {

    const length =
        room.players.length;

    room.currentPlayer =
        (
            room.currentPlayer +
            room.direction * amount +
            length * 100
        ) % length;
}

function canPlay(card, top) {

    if (!top) return true;

    if (card.color === "wild")
        return true;

    if (card.color === top.color)
        return true;

    if (card.value === top.value)
        return true;

    if (
        top.chosenColor &&
        card.color === top.chosenColor
    )
        return true;

    return false;
}

function removeCard(hand, id) {

    const index =
        hand.findIndex(
            card => card.id === id
        );

    if (index === -1)
        return null;

    return hand.splice(index, 1)[0];
}

wss.on("connection", ws => {

    ws.id =
        Math.random()
        .toString(36)
        .substring(2);

    ws.on("message", raw => {

        let message;

        try {

            message =
                JSON.parse(
                    raw.toString()
                );

        } catch {

            send(ws, {
                type: "error",
                message: "Invalid request."
            });

            return;
        }

        /* CREATE ROOM */

        if (message.type === "create") {

            const name =
                String(
                    message.name || ""
                )
                .trim()
                .substring(0, 20);

            if (!name) {

                send(ws, {
                    type: "error",
                    message:
                        "Enter your player name."
                });

                return;
            }

            const room = {

                code:
                    createRoomCode(),

                hostId:
                    ws.id,

                players: [],

                started: false,

                deck: [],

                discard: [],

                currentPlayer: 0,

                direction: 1,

                winner: null
            };

            room.players.push({

                id: ws.id,

                ws,

                name,

                hand: []

            });

            ws.room =
                room.code;

            rooms.set(
                room.code,
                room
            );

            send(ws, {
                type: "joined",
                room: room.code,
                host: true
            });

            broadcast(room);

            return;
        }

        /* JOIN ROOM */

        if (message.type === "join") {

            const name =
                String(
                    message.name || ""
                )
                .trim()
                .substring(0, 20);

            const roomCode =
                String(
                    message.code || ""
                )
                .trim()
                .toUpperCase();

            const room =
                rooms.get(roomCode);

            if (!name) {

                send(ws, {
                    type: "error",
                    message:
                        "Enter your player name."
                });

                return;
            }

            if (!room) {

                send(ws, {
                    type: "error",
                    message:
                        "Room not found."
                });

                return;
            }

            if (room.started) {

                send(ws, {
                    type: "error",
                    message:
                        "Game already started."
                });

                return;
            }

            if (room.players.length >= 4) {

                send(ws, {
                    type: "error",
                    message:
                        "Room is full."
                });

                return;
            }

            room.players.push({

                id: ws.id,

                ws,

                name,

                hand: []

            });

            ws.room =
                room.code;

            send(ws, {
                type: "joined",
                room: room.code,
                host: false
            });

            broadcast(room);

            return;
        }

        const room =
            rooms.get(ws.room);

        if (!room)
            return;

        const playerIndex =
            room.players.findIndex(
                p => p.id === ws.id
            );

        if (playerIndex === -1)
            return;

        /* START */

        if (message.type === "start") {

            if (
                ws.id !== room.hostId
            ) {

                send(ws, {
                    type: "error",
                    message:
                        "Only the host can start."
                });

                return;
            }

            if (
                room.players.length < 2
            ) {

                send(ws, {
                    type: "error",
                    message:
                        "Need at least 2 players."
                });

                return;
            }

            startGame(room);

            broadcast(room);

            return;
        }

        /* REMATCH */

        if (message.type === "rematch") {

            if (
                ws.id !== room.hostId
            ) {

                send(ws, {
                    type: "error",
                    message:
                        "Only host can restart."
                });

                return;
            }

            startGame(room);

            broadcast(room);

            return;
        }

        if (!room.started)
            return;

        /* TURN CHECK */

        if (
            room.currentPlayer !==
            playerIndex
        ) {

            send(ws, {
                type: "error",
                message:
                    "It is not your turn."
            });

            return;
        }

        /* DRAW */

        if (message.type === "draw") {

            refillDeck(room);

            if (!room.deck.length) {

                send(ws, {
                    type: "error",
                    message:
                        "No cards available."
                });

                return;
            }

            const card =
                room.deck.pop();

            room.players[
                playerIndex
            ].hand.push(card);

            nextPlayer(room);

            broadcast(room);

            return;
        }

        /* PLAY */

        if (message.type === "play") {

            const player =
                room.players[
                    playerIndex
                ];

            const card =
                player.hand.find(
                    c =>
                        c.id ===
                        message.cardId
                );

            const top =
                room.discard[
                    room.discard.length - 1
                ];

            if (!card) {

                send(ws, {
                    type: "error",
                    message:
                        "Card not found."
                });

                return;
            }

            if (
                !canPlay(card, top)
            ) {

                send(ws, {
                    type: "error",
                    message:
                        "You cannot play this card."
                });

                return;
            }

            if (
                card.color === "wild"
            ) {

                const color =
                    String(
                        message.color || ""
                    ).toLowerCase();

                if (
                    !COLORS.includes(color)
                ) {

                    send(ws, {
                        type: "error",
                        message:
                            "Choose a valid color."
                    });

                    return;
                }

                card.chosenColor =
                    color;
            }

            removeCard(
                player.hand,
                card.id
            );

            room.discard.push(card);

            /* WIN */

            if (
                player.hand.length === 0
            ) {

                room.started = false;

                room.winner =
                    player.name;

                broadcast(room);

                return;
            }

            /* REVERSE */

            if (
                card.value === "reverse"
            ) {

                if (
                    room.players.length === 2
                ) {

                    nextPlayer(
                        room,
                        2
                    );

                } else {

                    room.direction *= -1;

                    nextPlayer(room);
                }
            }

            /* SKIP */

            else if (
                card.value === "skip"
            ) {

                nextPlayer(
                    room,
                    2
                );
            }

            /* DRAW 2 */

            else if (
                card.value === "draw2"
            ) {

                nextPlayer(room);

                const target =
                    room.players[
                        room.currentPlayer
                    ];

                for (
                    let i = 0;
                    i < 2;
                    i++
                ) {

                    refillDeck(room);

                    if (room.deck.length)
                        target.hand.push(
                            room.deck.pop()
                        );
                }

                nextPlayer(room);
            }

            /* DRAW 4 */

            else if (
                card.value === "draw4"
            ) {

                nextPlayer(room);

                const target =
                    room.players[
                        room.currentPlayer
                    ];

                for (
                    let i = 0;
                    i < 4;
                    i++
                ) {

                    refillDeck(room);

                    if (room.deck.length)
                        target.hand.push(
                            room.deck.pop()
                        );
                }

                nextPlayer(room);
            }

            else {

                nextPlayer(room);
            }

            broadcast(room);

            return;
        }
    });

    ws.on("close", () => {

        const room =
            rooms.get(ws.room);

        if (!room)
            return;

        const index =
            room.players.findIndex(
                p => p.id === ws.id
            );

        if (index !== -1)
            room.players.splice(index, 1);

        if (
            room.players.length === 0
        ) {

            rooms.delete(
                room.code
            );

            return;
        }

        if (
            room.hostId === ws.id
        ) {

            room.hostId =
                room.players[0].id;
        }

        if (
            room.currentPlayer >=
            room.players.length
        ) {

            room.currentPlayer = 0;
        }

        broadcast(room);
    });
});

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `UNO NO MERCY running on ${PORT}`
        );
    }
);
