import type { GameOpening } from './openings';
import { score, type Tally } from './report';
import type { Color } from './types';

export interface TreeNode extends Tally {
  key: string; // `${color}|${sans joined}` ('' line for the root)
  san: string;
  ply: number; // ply index of `san` (-1 for the root)
  line: string[];
  /** The position after this move is still in the book. */
  inBook: boolean;
  /** Games that left the book with this very move. */
  exits: number;
  /** Deepest opening name seen by games passing here. */
  opening: string | null;
  items: GameOpening[];
  children: TreeNode[];
}

export const TREE_PLIES = 24;

/** The tree of everything the user actually played with one colour (first `TREE_PLIES` plies). */
export function buildTree(all: GameOpening[], color: Color, maxPly = TREE_PLIES): TreeNode {
  const items = all.filter((i) => i.game.color === color);
  const mk = (line: string[], ply: number): TreeNode => ({
    key: `${color}|${line.join(' ')}`, san: line[ply] ?? '', ply, line, inBook: true, exits: 0, opening: null,
    items: [], children: [], n: 0, points: 0, wins: 0, draws: 0, losses: 0,
  });
  const root = mk([], -1);
  const index = new Map<string, TreeNode>([[root.key, root]]);
  const add = (node: TreeNode, it: GameOpening) => {
    node.items.push(it);
    node.n++;
    node.points += it.game.score;
    if (it.game.score === 1) node.wins++;
    else if (it.game.score === 0) node.losses++;
    else node.draws++;
  };
  for (const it of items) {
    add(root, it);
    let parent = root;
    for (let ply = 0; ply < Math.min(it.sans.length, maxPly); ply++) {
      const line = it.sans.slice(0, ply + 1);
      const key = `${color}|${line.join(' ')}`;
      let node = index.get(key);
      if (!node) {
        node = mk(line, ply);
        node.inBook = ply < it.exitPly;
        index.set(key, node);
        parent.children.push(node);
      }
      if (ply === it.exitPly) node.exits++;
      if (ply < it.exitPly && it.opening) node.opening = it.opening.name;
      add(node, it);
      parent = node;
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => b.n - a.n);
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function findNode(root: TreeNode, line: string[]): TreeNode | null {
  let node: TreeNode | undefined = root;
  for (const san of line) {
    node = node.children.find((c) => c.san === san);
    if (!node) return null;
  }
  return node;
}

export type Tone = 'win' | 'lose' | 'even' | 'few';

/** Green when the user scores clearly above their average with this colour, red when clearly below. */
export function tone(node: Tally, baseline: number, minGames = 3, margin = 0.05): Tone {
  if (node.n < minGames) return 'few';
  const d = score(node) - baseline;
  return d >= margin ? 'win' : d <= -margin ? 'lose' : 'even';
}
