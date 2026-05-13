import asyncio
import json
import random
import statistics
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


def make_bot(bot_type: str, player: Player, mcts_iterations: int = 200) -> RandomBot | MCTSBot | None:
    if bot_type == "human":
        return None
    elif bot_type == "random":
        return RandomBot(player)
    elif bot_type == "mcts":
        return MCTSBot(player, iterations=mcts_iterations)
    else:
        raise ValueError(f"Unknown bot type: {bot_type}")


async def run_analysis(iterations: int, bot1_type: str, bot2_type: str, websocket: WebSocket):
    loop = asyncio.get_event_loop()
    # Use lower MCTS iterations (50) for faster analysis
    bot1 = make_bot(bot1_type, Player.P1, mcts_iterations=50)
    bot2 = make_bot(bot2_type, Player.P2, mcts_iterations=50)

    logger.info(f"Analysis starting: {iterations} games, {bot1_type} vs {bot2_type}")

    results = {
        "p1_wins": 0,
        "p2_wins": 0,
        "bot_wins": {},  # Track wins by bot type
        "turns": [],
        "win_methods": [],  # "four_in_a_row" or "all_pieces"
        "both_koalas_used": 0,
    }

    # Initialize bot win tracking
    results["bot_wins"][bot1_type] = 0
    results["bot_wins"][bot2_type] = 0

    for i in range(iterations):
        state = initial_state()

        # Alternate which bot type goes first (if they're different)
        if bot1_type != bot2_type and i % 2 == 1:
            # Swap bots for odd-numbered games to alternate first player
            current_bot1, current_bot2 = bot2, bot1
            current_bot1_type, current_bot2_type = bot2_type, bot1_type
        else:
            current_bot1, current_bot2 = bot1, bot2
            current_bot1_type, current_bot2_type = bot1_type, bot2_type

        while not is_terminal(state):
            bot = current_bot1 if state.current == Player.P1 else current_bot2
            move = await loop.run_in_executor(None, bot.choose_move, state)
            state = apply_move(state, move)

        # Record results
        if state.winner == Player.P1:
            results["p1_wins"] += 1
            results["bot_wins"][current_bot1_type] += 1
        elif state.winner == Player.P2:
            results["p2_wins"] += 1
            results["bot_wins"][current_bot2_type] += 1

        results["turns"].append(state.turn_number)

        # Determine win method (four_in_a_row if supply > 0, all_pieces if supply == 0)
        if state.winner:
            winner_supply = state.supply[0] if state.winner == Player.P1 else state.supply[1]
            is_all_pieces = (winner_supply.regular == 0 and winner_supply.pusher == 0 and winner_supply.yellow == 0)
            results["win_methods"].append("all_pieces" if is_all_pieces else "four_in_a_row")
        else:
            results["win_methods"].append("stalemate")

        # Check if both koalas were used
        if state.supply[0].yellow == 0 and state.supply[1].yellow == 0:
            results["both_koalas_used"] += 1

        # Send progress update after each game
        try:
            progress_msg = {
                "type": "analysis_progress",
                "completed": i + 1,
                "total": iterations
            }
            await websocket.send_json(progress_msg)
        except Exception as e:
            logger.error(f"Error sending progress: {e}")

    # Calculate final statistics
    total_games = iterations
    four_in_a_row_wins = sum(1 for m in results["win_methods"] if m == "four_in_a_row")

    # Calculate bot type win percentages
    bot_type_stats = {}
    for bot_type, wins in results["bot_wins"].items():
        bot_type_stats[bot_type] = (wins / total_games) * 100 if total_games > 0 else 0

    stats = {
        "p1_wins": results["p1_wins"],
        "p2_wins": results["p2_wins"],
        "p1_win_pct": (results["p1_wins"] / total_games) * 100,
        "p2_win_pct": (results["p2_wins"] / total_games) * 100,
        "bot_type_stats": bot_type_stats,
        "four_in_a_row_wins": four_in_a_row_wins,
        "four_in_a_row_pct": (four_in_a_row_wins / total_games) * 100 if total_games > 0 else 0,
        "avg_turns": sum(results["turns"]) / len(results["turns"]) if results["turns"] else 0,
        "median_turns": statistics.median(results["turns"]) if results["turns"] else 0,
        "min_turns": min(results["turns"]) if results["turns"] else 0,
        "max_turns": max(results["turns"]) if results["turns"] else 0,
        "both_koalas_used_pct": (results["both_koalas_used"] / total_games) * 100,
    }

    logger.info(f"Analysis complete. Results: P1={results['p1_wins']} P2={results['p2_wins']}")
    try:
        await websocket.send_json({
            "type": "analysis_complete",
            "stats": stats
        })
    except Exception as e:
        logger.error(f"Error sending analysis results: {e}")


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

            elif msg_type == "start_analysis":
                iterations = data.get("iterations", 20)
                bot1_type = data.get("bot1", "random")
                bot2_type = data.get("bot2", "random")
                logger.info(f"Starting analysis: iterations={iterations}, bot1={bot1_type}, bot2={bot2_type}")
                analysis_task = asyncio.create_task(run_analysis(iterations, bot1_type, bot2_type, websocket))

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

    uvicorn.run(app, host="0.0.0.0", port=8001)
