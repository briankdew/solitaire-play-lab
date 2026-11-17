// Shared by every module: the game rules (G), settings and timing constants, the game's
// changing state (S), and small helpers, including the status line (say).
import { statusEl } from './dom.js';

/** The game's changing state, shared by the modules. */
export const S = {
  settings: null,
  autoFinish: true,
  state: null,
  shuffleState: null,
  history: [],
  record: [],
  undoneSeq: [],   // the play lab's numbers of undone actions (neutral lines in the Game Recorder)
  moves: 0,
  busy: false,
  closed: false,
  suppressAuto: false,
  L: null,
  drag: null,
  faceArt: null,   // imported card faces in use (ui/cardart.js): { set, cards: Set of card ids }, or null
};

export const G = window.SixCard;

/** The game being replayed (index.html?replay=<game id>, ui/study.js), or null when playing. */
export const STUDY_ID = new URLSearchParams(location.search).get('replay');

export const AUTO_STEP_MS = 180;
export const REFILL_LOCK_MS = 500; // after the refresh arrow, stock clicks are ignored this long (a reflex double click)
export const DRAG_THRESHOLD = 5;
// The play lab's own memory of the settings: the solitaire-study app on the same localhost port keeps
// its own under 'solitaire-study.settings', so the two no longer share (or overwrite) a setup.
export const SETTINGS_KEY = 'solitaire-play-lab.settings';
/** The play lab starts with a standard game: K473 (A–K in four suits, seven columns, draw 3). */
export const LAB_DEFAULT_SETTINGS = { highest: 13, suits: 4, columns: 7, draw: 3 };
// Raised whenever the rules change how a saved game deals or plays (2: row deal, suit order ♠ ♥ ♣ ♦).
export const SAVE_RULES = 2;
export const AUTO_FINISH_KEY = 'solitaire-study.autoFinish';
export const CARD_FONT_KEY = 'solitaire-study.cardFont';
export const Z = { stock: 100, waste: 200, foundation: 300, tableau: 400, moving: 1000, dragging: 3000 };

// Pip positions inside the .pips box, as [x%, y%]; pips below the middle are drawn upside down.
export const PIPS = {
  1: [[50, 50]],
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33], [100, 33], [50, 50], [0, 67], [100, 67], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 17], [0, 33], [100, 33], [0, 67], [100, 67], [50, 83], [0, 100], [100, 100]],
};

export const top = (pile) => pile[pile.length - 1];
export const rankLabel = (rank) => G.RANK_LABEL[rank];
export const withArticle = (rank) => (rank === 8 ? 'an ' : 'a ') + rankLabel(rank);
/** The setup code (the record header): highest card, suits, columns, draw, as G.setupText writes it. */
/** The four-character setup (highest, suits, columns, draw), e.g. 4223: the current settings, or the ones given. */
export const setupCode = (s = S.settings) => rankLabel(s.highest) + s.suits + s.columns + s.draw;

/** A dealt game that hasn't been won or quit. */
export function inPlay() {
  return !!S.state && !S.state.pending && !S.closed && !G.isWon(S.state);
}

// With nothing else to say, a game in play shows "Good luck!" rather than an empty line.
export function say(msg) { statusEl.textContent = msg || (inPlay() ? 'Good luck!' : ''); }
