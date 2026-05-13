import random
import math
from .game import GameState, Move, Player, legal_moves, apply_move, is_terminal


class RandomBot:
    def __init__(self, player: Player, seed: int | None = None):
        self.player = player
        self.rng = random.Random(seed)

    def choose_move(self, state: GameState) -> Move:
        moves = legal_moves(state)
        return self.rng.choice(moves)


class MCTSNode:
    __slots__ = ["state", "parent", "move", "children", "visits", "wins", "untried_moves"]

    def __init__(self, state: GameState, parent=None, move=None):
        self.state = state
        self.parent = parent
        self.move = move
        self.children = []
        self.visits = 0
        self.wins = 0.0
        self.untried_moves = legal_moves(state)


class MCTSBot:
    def __init__(self, player: Player, iterations: int = 1000, exploration: float = 1.414):
        self.player = player
        self.iterations = iterations
        self.c = exploration

    def choose_move(self, state: GameState) -> Move:
        root = MCTSNode(state)
        for _ in range(self.iterations):
            node = self._select(root)
            if is_terminal(node.state):
                result = self._evaluate_terminal(node.state)
                self._backpropagate(node, result)
            elif node.untried_moves:
                node = self._expand(node)
                result = self._rollout(node.state)
                self._backpropagate(node, result)

        best = max(root.children, key=lambda n: n.visits)
        return best.move

    def _select(self, node: MCTSNode) -> MCTSNode:
        while not is_terminal(node.state) and not node.untried_moves:
            node = self._best_uct(node)
        return node

    def _expand(self, node: MCTSNode) -> MCTSNode:
        move = random.choice(node.untried_moves)
        node.untried_moves.remove(move)

        child_state = apply_move(node.state, move)
        child = MCTSNode(child_state, parent=node, move=move)
        node.children.append(child)
        return child

    def _evaluate_terminal(self, state: GameState) -> float:
        if state.winner == self.player:
            return 1.0
        elif state.winner is None:
            return 0.5
        else:
            return 0.0

    def _rollout(self, state: GameState, max_depth: int = 200) -> float:
        current = state
        depth = 0
        bot = RandomBot(current.current)

        while not is_terminal(current) and depth < max_depth:
            move = bot.choose_move(current)
            current = apply_move(current, move)
            depth += 1

        if current.winner == self.player:
            return 1.0
        elif current.winner is None:
            return 0.5
        else:
            return 0.0

    def _backpropagate(self, node: MCTSNode, result: float):
        while node is not None:
            node.visits += 1
            if node.parent is None:
                node.wins += result
            else:
                mover = node.parent.state.current
                if mover == self.player:
                    node.wins += result
                else:
                    node.wins += 1.0 - result
            node = node.parent

    def _best_uct(self, node: MCTSNode) -> MCTSNode:
        best_child = None
        best_uct = -float("inf")

        for child in node.children:
            if child.visits == 0:
                uct = float("inf")
            else:
                exploitation = child.wins / child.visits
                exploration = self.c * math.sqrt(math.log(node.visits) / child.visits)
                uct = exploitation + exploration

            if uct > best_uct:
                best_uct = uct
                best_child = child

        return best_child
