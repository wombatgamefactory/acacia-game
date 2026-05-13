from dataclasses import dataclass
from enum import Enum, auto
from typing import Literal


class PieceType(Enum):
    REGULAR = auto()
    PUSHER = auto()
    YELLOW = auto()


class Player(Enum):
    P1 = 1
    P2 = 2


Cell = tuple[Player, PieceType] | None
Board = tuple[Cell, ...]


@dataclass(frozen=True)
class Supply:
    regular: int
    pusher: int
    yellow: int


@dataclass(frozen=True)
class GameState:
    board: Board
    supply: tuple[Supply, Supply]
    current: Player
    turn_number: int
    winner: Player | None
    is_first_move: bool


@dataclass(frozen=True)
class Move:
    action: Literal["place", "eject"]
    row: int
    col: int
    piece_type: PieceType


def _index(row: int, col: int) -> int:
    return row * 6 + col


def _rc(index: int) -> tuple[int, int]:
    return index // 6, index % 6


def _adjacents(row: int, col: int) -> list[tuple[int, int]]:
    result = []
    for dr in [-1, 0, 1]:
        for dc in [-1, 0, 1]:
            if dr == 0 and dc == 0:
                continue
            r, c = row + dr, col + dc
            if 0 <= r < 6 and 0 <= c < 6:
                result.append((r, c))
    return result


def _has_occupied_neighbor(board: Board, row: int, col: int) -> bool:
    for r, c in _adjacents(row, col):
        if board[_index(r, c)] is not None:
            return True
    return False


def supply_spend(s: Supply, piece: PieceType) -> Supply:
    if piece == PieceType.REGULAR:
        return Supply(s.regular - 1, s.pusher, s.yellow)
    elif piece == PieceType.PUSHER:
        return Supply(s.regular, s.pusher - 1, s.yellow)
    else:  # YELLOW
        return Supply(s.regular, s.pusher, s.yellow - 1)


def supply_gain(s: Supply, piece: PieceType) -> Supply:
    if piece == PieceType.REGULAR:
        return Supply(s.regular + 1, s.pusher, s.yellow)
    elif piece == PieceType.PUSHER:
        return Supply(s.regular, s.pusher + 1, s.yellow)
    else:  # YELLOW
        return Supply(s.regular, s.pusher, s.yellow + 1)


def initial_state() -> GameState:
    board: Board = tuple([None] * 36)
    p1_supply = Supply(regular=8, pusher=4, yellow=1)
    p2_supply = Supply(regular=8, pusher=4, yellow=1)
    return GameState(
        board=board,
        supply=(p1_supply, p2_supply),
        current=Player.P1,
        turn_number=1,
        winner=None,
        is_first_move=True,
    )


def _check_win(board: Board, player: Player) -> bool:
    directions = [(0, 1), (1, 0), (1, 1), (1, -1)]
    for dr, dc in directions:
        for r in range(6):
            for c in range(6):
                if r + 3 * dr < 0 or r + 3 * dr >= 6:
                    continue
                if c + 3 * dc < 0 or c + 3 * dc >= 6:
                    continue
                if all(
                    board[_index(r + i * dr, c + i * dc)] is not None
                    and board[_index(r + i * dr, c + i * dc)][0] == player
                    and board[_index(r + i * dr, c + i * dc)][1] != PieceType.YELLOW
                    for i in range(4)
                ):
                    return True
    return False


def legal_moves(state: GameState) -> list[Move]:
    moves = []

    if state.winner is not None:
        return moves

    current_player = state.current
    opponent = Player.P2 if current_player == Player.P1 else Player.P1
    current_supply = state.supply[0 if current_player == Player.P1 else 1]
    opponent_supply = state.supply[1 if current_player == Player.P1 else 0]

    if current_supply.regular > 0:
        for i, cell in enumerate(state.board):
            if cell is None:
                r, c = _rc(i)
                if state.is_first_move or _has_occupied_neighbor(state.board, r, c):
                    moves.append(Move("place", r, c, PieceType.REGULAR))

    if current_supply.pusher > 0:
        for i, cell in enumerate(state.board):
            if cell is not None and cell[0] == opponent and cell[1] == PieceType.REGULAR:
                r, c = _rc(i)
                moves.append(Move("eject", r, c, PieceType.PUSHER))

    if current_supply.yellow > 0:
        for i, cell in enumerate(state.board):
            if cell is not None and cell[0] == opponent and cell[1] == PieceType.PUSHER:
                r, c = _rc(i)
                moves.append(Move("eject", r, c, PieceType.YELLOW))

    return moves


def apply_move(state: GameState, move: Move) -> GameState:
    board_list = list(state.board)
    current_player = state.current
    opponent = Player.P2 if current_player == Player.P1 else Player.P1

    current_idx = 0 if current_player == Player.P1 else 1
    opponent_idx = 1 if current_player == Player.P1 else 0

    supply_list = [state.supply[0], state.supply[1]]

    target_idx = _index(move.row, move.col)

    if move.action == "place":
        board_list[target_idx] = (current_player, move.piece_type)
        supply_list[current_idx] = supply_spend(supply_list[current_idx], move.piece_type)
    elif move.action == "eject":
        victim_cell = board_list[target_idx]
        victim_piece = victim_cell[1]

        board_list[target_idx] = (current_player, move.piece_type)
        supply_list[current_idx] = supply_spend(supply_list[current_idx], move.piece_type)
        supply_list[opponent_idx] = supply_gain(supply_list[opponent_idx], victim_piece)

    new_board = tuple(board_list)

    winner = None
    if _check_win(new_board, current_player):
        winner = current_player
    elif supply_list[current_idx] == Supply(0, 0, 0):
        winner = current_player

    next_player = opponent

    return GameState(
        board=new_board,
        supply=(supply_list[0], supply_list[1]),
        current=next_player,
        turn_number=state.turn_number + 1,
        winner=winner,
        is_first_move=False,
    )


def is_terminal(state: GameState) -> bool:
    return state.winner is not None or len(legal_moves(state)) == 0
