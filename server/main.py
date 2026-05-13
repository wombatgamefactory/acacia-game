import asyncio
import json
import random
from dataclasses import dataclass, asdict, field
from pathlib import Path
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from engine import GameState, Player, PieceType, Move, legal_moves, apply_move, is_terminal, initial_state
from engine.bots import RandomBot, MCTSBot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"


@dataclass
class GameSession:
    state: GameState
    bot_p1: RandomBot | MCTSBot | None
    bot_p2: RandomBot | MCTSBot | None
    running: bool = False
    speed_ms: float = 500.0
    game_task: asyncio.Task | None = None
    websocket: WebSocket | None = None
    human_player: Player | None = None
    human_move_event: asyncio.Event = field(default_factory=asyncio.Event)
    pending_human_move: Move | None = None


def serialize_state(state: GameState) -> dict:
    board_cells = []
    for i, cell in enumerate(state.board):
        if cell is not None:
            r, c = i // 6, i % 6
            player, ptype = cell
            board_cells.append({
                "row": r,
                "col": c,
                "player": player.name.lower(),
                "piece": ptype.name.lower(),
            })

    supply_p1 = asdict(state.supply[0])
    supply_p2 = asdict(state.supply[1])

    return {
        "type": "state",
        "board": board_cells,
        "supply": {"p1": supply_p1, "p2": supply_p2},
        "current": state.current.name.lower(),
        "turn": state.turn_number,
        "winner": state.winner.name.lower() if state.winner else None,
        "terminal": is_terminal(state),
    }


def assign_human_player() -> Player:
    return random.choice([Player.P1, Player.P2])


def make_bot(bot_type: str, player: Player) -> RandomBot | MCTSBot | None:
    if bot_type == "human":
        return None
    elif bot_type == "random":
        return RandomBot(player)
    elif bot_type == "mcts":
        return MCTSBot(player, iterations=1000)
    else:
        raise ValueError(f"Unknown bot type: {bot_type}")


async def broadcast_state(session: GameSession):
    if session.websocket:
        try:
            msg = serialize_state(session.state)
            await session.websocket.send_json(msg)
        except Exception as e:
            logger.error(f"Error broadcasting state: {e}")


async def run_game_loop(session: GameSession):
    loop = asyncio.get_event_loop()

    while session.running and not is_terminal(session.state):
        try:
            current_player = session.state.current

            if current_player == session.human_player:
                # Human turn — send legal moves and wait for input
                moves = legal_moves(session.state)
                if session.websocket:
                    await session.websocket.send_json({
                        "type": "your_turn",
                        "legal_moves": [
                            {
                                "action": m.action,
                                "row": m.row,
                                "col": m.col,
                                "piece_type": m.piece_type.name.lower()
                            }
                            for m in moves
                        ]
                    })
                session.human_move_event.clear()
                await session.human_move_event.wait()
                move = session.pending_human_move
                session.pending_human_move = None
            else:
                # Bot turn
                bot = session.bot_p1 if current_player == Player.P1 else session.bot_p2
                move = await loop.run_in_executor(None, bot.choose_move, session.state)

            session.state = apply_move(session.state, move)
            await broadcast_state(session)

            if is_terminal(session.state):
                winner_msg = {
                    "type": "game_over",
                    "winner": session.state.winner.name.lower() if session.state.winner else None,
                    "reason": "four_in_a_row" if session.state.winner else "stalemate",
                }
                if session.websocket:
                    await session.websocket.send_json(winner_msg)
                break

            # Only sleep after bot moves, not after human moves (human controls pacing)
            if session.human_player is None or current_player != session.human_player:
                await asyncio.sleep(session.speed_ms / 1000.0)

        except asyncio.CancelledError:
            logger.info("Game loop cancelled")
            break
        except Exception as e:
            logger.error(f"Error in game loop: {e}")
            break

    session.running = False


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection established")

    session = GameSession(
        state=initial_state(),
        bot_p1=make_bot("random", Player.P1),
        bot_p2=make_bot("random", Player.P2),
        websocket=websocket,
    )

    try:
        await broadcast_state(session)

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "control":
                action = data.get("action")

                if action == "play":
                    if not session.running and not is_terminal(session.state):
                        session.running = True
                        session.game_task = asyncio.create_task(run_game_loop(session))

                elif action == "pause":
                    session.running = False
                    if session.game_task:
                        session.game_task.cancel()
                        try:
                            await session.game_task
                        except asyncio.CancelledError:
                            pass
                        session.game_task = None

                elif action == "step":
                    if not session.running and not is_terminal(session.state):
                        bot = session.bot_p1 if session.state.current == Player.P1 else session.bot_p2
                        loop = asyncio.get_event_loop()
                        move = await loop.run_in_executor(None, bot.choose_move, session.state)
                        session.state = apply_move(session.state, move)
                        await broadcast_state(session)

                        if is_terminal(session.state):
                            winner_msg = {
                                "type": "game_over",
                                "winner": session.state.winner.name.lower() if session.state.winner else None,
                                "reason": "four_in_a_row" if session.state.winner else "stalemate",
                            }
                            await websocket.send_json(winner_msg)

                elif action == "reset":
                    session.running = False
                    if session.game_task:
                        session.game_task.cancel()
                        try:
                            await session.game_task
                        except asyncio.CancelledError:
                            pass
                        session.game_task = None
                    session.state = initial_state()
                    # Re-randomize human player if one exists
                    if session.human_player is not None:
                        session.human_player = assign_human_player()
                        await websocket.send_json({
                            "type": "player_assignment",
                            "human_player": session.human_player.name.lower()
                        })
                    await broadcast_state(session)

                elif action == "set_speed":
                    session.speed_ms = float(data.get("ms", 500))

                elif action == "set_bots":
                    bot1_type = data.get("p1", "random")
                    bot2_type = data.get("p2", "random")
                    session.bot_p1 = make_bot(bot1_type, Player.P1)
                    session.bot_p2 = make_bot(bot2_type, Player.P2)

                    # Determine if there's a human player and assign randomly
                    if bot1_type == "human" or bot2_type == "human":
                        if bot1_type == "human" and bot2_type == "human":
                            # Both human? Just pick P1 as the human, P2 as random
                            session.bot_p2 = make_bot("random", Player.P2)
                            session.human_player = Player.P1
                        elif bot1_type == "human":
                            session.human_player = Player.P1
                        else:
                            session.human_player = Player.P2

                        await websocket.send_json({
                            "type": "player_assignment",
                            "human_player": session.human_player.name.lower()
                        })
                    else:
                        session.human_player = None

                    logger.info(f"Bots set: P1={bot1_type}, P2={bot2_type}, Human={session.human_player}")

            elif msg_type == "move":
                # Human player move
                try:
                    action = data.get("action")
                    row = int(data.get("row"))
                    col = int(data.get("col"))
                    piece_type = PieceType[data.get("piece_type").upper()]
                    move = Move(action=action, row=row, col=col, piece_type=piece_type)

                    # Validate move is legal
                    legal = legal_moves(session.state)
                    if move in legal:
                        session.pending_human_move = move
                        session.human_move_event.set()
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Illegal move"
                        })
                except Exception as e:
                    logger.error(f"Error processing move: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": str(e)
                    })

    except WebSocketDisconnect:
        logger.info("WebSocket connection closed")
        session.running = False
        if session.game_task:
            session.game_task.cancel()
            try:
                await session.game_task
            except asyncio.CancelledError:
                pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        session.running = False
        if session.game_task:
            session.game_task.cancel()
            try:
                await session.game_task
            except asyncio.CancelledError:
                pass


# Mount static files as catch-all after all routes
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
