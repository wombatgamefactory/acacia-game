import argparse
from engine import GameState, legal_moves, apply_move, is_terminal, initial_state, Player
from engine.bots import RandomBot, MCTSBot


def run_game(bot1, bot2):
    """Returns (winner, turn_count). winner=None for stalemate."""
    state = initial_state()
    while not is_terminal(state):
        bot = bot1 if state.current == Player.P1 else bot2
        move = bot.choose_move(state)
        state = apply_move(state, move)
    return state.winner, state.turn_number


def make_bot(bot_type, player, seed, mcts_iterations):
    if bot_type == "random":
        return RandomBot(player, seed=seed)
    elif bot_type == "mcts":
        return MCTSBot(player, iterations=mcts_iterations)
    else:
        raise ValueError(f"Unknown bot type: {bot_type}")


def main():
    parser = argparse.ArgumentParser(description="Run Acacia game simulations")
    parser.add_argument("--games", type=int, default=100, help="Number of games to run")
    parser.add_argument(
        "--bot1", choices=["random", "mcts"], default="random", help="Bot 1 type"
    )
    parser.add_argument(
        "--bot2", choices=["random", "mcts"], default="random", help="Bot 2 type"
    )
    parser.add_argument(
        "--mcts-iterations", type=int, default=200, help="MCTS iterations per move"
    )
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    args = parser.parse_args()

    results = {"p1": 0, "p2": 0, "draw": 0, "turns": []}

    print(f"Running {args.games} games: {args.bot1} vs {args.bot2}")
    if args.bot1 == "mcts" or args.bot2 == "mcts":
        print(f"MCTS iterations: {args.mcts_iterations}")

    for i in range(args.games):
        seed = args.seed + i if args.seed is not None else None
        b1 = make_bot(args.bot1, Player.P1, seed, args.mcts_iterations)
        b2 = make_bot(args.bot2, Player.P2, seed, args.mcts_iterations)
        winner, turns = run_game(b1, b2)
        key = winner.name.lower() if winner else "draw"
        results[key] += 1
        results["turns"].append(turns)

        if (i + 1) % 10 == 0:
            pct = (i + 1) / args.games * 100
            print(
                f"  Game {i+1}/{args.games} ({pct:.0f}%) - P1: {results['p1']} P2: {results['p2']} Draw: {results['draw']}"
            )

    avg_turns = sum(results["turns"]) / len(results["turns"])
    p1_win_rate = results["p1"] / args.games * 100
    p2_win_rate = results["p2"] / args.games * 100
    draw_rate = results["draw"] / args.games * 100

    print(f"\nResults:")
    print(f"  P1 wins: {results['p1']} ({p1_win_rate:.1f}%)")
    print(f"  P2 wins: {results['p2']} ({p2_win_rate:.1f}%)")
    print(f"  Draws:   {results['draw']} ({draw_rate:.1f}%)")
    print(f"  Avg turns per game: {avg_turns:.1f}")
    print(f"  Min/Max turns: {min(results['turns'])}/{max(results['turns'])}")


if __name__ == "__main__":
    main()
