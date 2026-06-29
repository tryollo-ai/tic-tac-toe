"use client";

import { useEffect, useMemo, useState } from "react";
import classNames from "classnames";
import Board, {
  DEFAULT_BOARD_ANIMATION,
  type BoardAnimationConfig,
  type BoardTransition,
} from "@/common/components/Board";
import {
  shiftBoard,
  type Board as BoardState,
  type Direction,
  type ShiftMode,
} from "@/utils/gameLogic";
import styles from "./styles.module.scss";

/** The fixed scene the loop animates:  x x _ / _ o _ / o _ x. */
const INITIAL: BoardState = ["X", "X", null, null, "O", null, "O", null, "X"];

// One loop iteration: play the shift, hold the end state, snap back to the
// start, then play again. PLAY is generous so even a slack (low-tension) spring
// finishes before the snap-back.
const PLAY_MS = 1700;
const RESET_MS = 650;

const DIRECTIONS: { dir: Direction; glyph: string }[] = [
  { dir: "top", glyph: "↑" },
  { dir: "left", glyph: "←" },
  { dir: "bottom", glyph: "↓" },
  { dir: "right", glyph: "→" },
];

const MODES: ShiftMode[] = ["classic", "collapse"];

type SpringKey = "slideSpring" | "leanSpring" | "departSpring";
type NumKey =
  | "leanReleaseDelayMs"
  | "leanReleaseDelayMsVertical"
  | "leanTiltDeg"
  | "leanSquash";

/** Serialize a config to source matching DEFAULT_BOARD_ANIMATION's style (object
 *  literal, unquoted keys), so it can be pasted straight over that constant. */
const formatSpring = (s: BoardAnimationConfig["slideSpring"]) =>
  `{ tension: ${s.tension}, friction: ${s.friction}${s.clamp ? ", clamp: true" : ""} }`;

const toSource = (a: BoardAnimationConfig) =>
  [
    "{",
    `  slideSpring: ${formatSpring(a.slideSpring)},`,
    `  leanSpring: ${formatSpring(a.leanSpring)},`,
    `  departSpring: ${formatSpring(a.departSpring)},`,
    `  leanReleaseDelayMs: ${a.leanReleaseDelayMs},`,
    `  leanReleaseDelayMsVertical: ${a.leanReleaseDelayMsVertical},`,
    `  leanTiltDeg: ${a.leanTiltDeg},`,
    `  leanSquash: ${a.leanSquash},`,
    "}",
  ].join("\n");

const Slider = (props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) => (
  <label className={styles.slider}>
    <span className={styles.sliderLabel}>{props.label}</span>
    <input
      className={styles.range}
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
    <span className={styles.sliderValue}>{props.value}</span>
  </label>
);

/** A tension/friction spring pair under a legend - the three springs share this
 *  shape and differ only by legend and tension range. */
const SpringGroup = (props: {
  legend: string;
  spring: { tension: number; friction: number };
  tensionMax: number;
  setField: (field: "tension" | "friction") => (value: number) => void;
}) => (
  <fieldset className={styles.group}>
    <legend>{props.legend}</legend>
    <Slider
      label="tension"
      value={props.spring.tension}
      min={50}
      max={props.tensionMax}
      step={10}
      onChange={props.setField("tension")}
    />
    <Slider
      label="friction"
      value={props.spring.friction}
      min={2}
      max={60}
      step={1}
      onChange={props.setField("friction")}
    />
  </fieldset>
);

/** The directional d-pad that picks the shift direction. */
const DPad = (props: {
  direction: Direction;
  onSelect: (dir: Direction) => void;
}) => (
  <div className={styles.dpad}>
    {DIRECTIONS.map(({ dir, glyph }) => (
      <button
        key={dir}
        type="button"
        className={classNames(styles.dirButton, styles[dir], {
          [styles.dirActive]: dir === props.direction,
        })}
        onClick={() => props.onSelect(dir)}
      >
        {glyph}
      </button>
    ))}
  </div>
);

/** The classic/collapse shift-mode toggle. */
const ModeToggle = (props: {
  mode: ShiftMode;
  onSelect: (mode: ShiftMode) => void;
}) => (
  <div className={styles.modes}>
    {MODES.map((m) => (
      <button
        key={m}
        type="button"
        className={classNames(styles.modeButton, {
          [styles.modeActive]: m === props.mode,
        })}
        onClick={() => props.onSelect(m)}
      >
        {m}
      </button>
    ))}
  </div>
);

/** The serialized-config readout with reset/copy actions and paste hint. */
const Readout = (props: {
  source: string;
  copied: boolean;
  onReset: () => void;
  onCopy: () => void;
}) => (
  <div className={styles.readout}>
    <div className={styles.readoutActions}>
      <button type="button" className={styles.resetButton} onClick={props.onReset}>
        Reset to defaults
      </button>
      <button type="button" className={styles.copyButton} onClick={props.onCopy}>
        {props.copied ? "Copied!" : "Copy config"}
      </button>
    </div>
    <p className={styles.hint}>
      Paste over <code>DEFAULT_BOARD_ANIMATION</code> in Board/index.tsx
    </p>
    <pre className={styles.json}>{props.source}</pre>
  </div>
);

/**
 * The harness's animation-loop and config-tuning engine: the chosen
 * direction/mode, the live {@link BoardAnimationConfig}, the self-flipping
 * play/rest loop that drives the board, and the serialized-config + copy state.
 * Returns render-ready board state, selectors that restart the loop on a
 * direction/mode switch, the spring/number field setters, and the readout.
 */
const useShiftDebug = () => {
  const [direction, setDirection] = useState<Direction>("right");
  const [mode, setMode] = useState<ShiftMode>("collapse");
  const [anim, setAnim] = useState<BoardAnimationConfig>(DEFAULT_BOARD_ANIMATION);
  // playing -> show the shifted board with a fresh shift cue; !playing -> snap
  // back to the start. The loop effect flips this on a timer. Starts at rest so
  // the first play slides from the start position rather than popping in, and we
  // drop back to rest on every direction/mode switch for a clean restart.
  const [playing, setPlaying] = useState(false);

  const shifted = useMemo(
    () => shiftBoard(INITIAL, direction, mode),
    [direction, mode],
  );
  // A fresh object each play phase so <Board> re-runs the animation; null while
  // resetting so it snaps back to the start with no reverse animation.
  const transition = useMemo<BoardTransition | null>(
    () => (playing ? { kind: "shift", direction, mode, from: INITIAL } : null),
    [playing, direction, mode],
  );

  useEffect(() => {
    const timer = setTimeout(
      () => setPlaying((p) => !p),
      playing ? PLAY_MS : RESET_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, direction, mode]);

  const setSpring = (key: SpringKey, field: "tension" | "friction") =>
    (value: number) =>
      setAnim((a) => ({ ...a, [key]: { ...a[key], [field]: value } }));
  const setNum = (key: NumKey) => (value: number) =>
    setAnim((a) => ({ ...a, [key]: value }));

  const source = toSource(anim);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    navigator.clipboard?.writeText(source).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return {
    board: playing ? shifted : INITIAL,
    transition,
    anim,
    direction,
    mode,
    // Switching direction/mode drops back to rest for a clean restart.
    selectDirection: (dir: Direction) => {
      setDirection(dir);
      setPlaying(false);
    },
    selectMode: (m: ShiftMode) => {
      setMode(m);
      setPlaying(false);
    },
    setSpring,
    setNum,
    source,
    copied,
    reset: () => setAnim(DEFAULT_BOARD_ANIMATION),
    copy,
  };
};

/**
 * Dev-only harness for tuning the grid-shift animation. Renders the real
 * <Board> on a fixed scene, loops the shift in a chosen direction, and exposes
 * the {@link BoardAnimationConfig} springs/timings as live sliders so the motion
 * can be dialled in without editing code. The JSON readout can be pasted back
 * into DEFAULT_BOARD_ANIMATION once a feel is settled.
 */
const ShiftDebug = ({ onClose }: { onClose: () => void }) => {
  const {
    board,
    transition,
    anim,
    direction,
    mode,
    selectDirection,
    selectMode,
    setSpring,
    setNum,
    source,
    copied,
    reset,
    copy,
  } = useShiftDebug();

  return (
    <div className={styles.backdrop} role="dialog" aria-label="Shift animation debug">
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 className={styles.title}>Shift animation debug</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.stage}>
            <div className={styles.boardWrap}>
              <Board
                board={board}
                winningLine={null}
                onSquareClick={() => {}}
                disabled
                transition={transition}
                animation={anim}
              />
            </div>

            <DPad direction={direction} onSelect={selectDirection} />

            <ModeToggle mode={mode} onSelect={selectMode} />
          </div>

          <div className={styles.controls}>
            <SpringGroup
              legend="Lean spring"
              spring={anim.leanSpring}
              tensionMax={1500}
              setField={(field) => setSpring("leanSpring", field)}
            />

            <SpringGroup
              legend="Slide spring (speed)"
              spring={anim.slideSpring}
              tensionMax={1000}
              setField={(field) => setSpring("slideSpring", field)}
            />

            <SpringGroup
              legend="Release spring (back + fade)"
              spring={anim.departSpring}
              tensionMax={1000}
              setField={(field) => setSpring("departSpring", field)}
            />

            <fieldset className={styles.group}>
              <legend>Lean shape & timing</legend>
              <Slider label="release delay H (ms)" value={anim.leanReleaseDelayMs} min={0} max={800} step={10} onChange={setNum("leanReleaseDelayMs")} />
              <Slider label="release delay V (ms)" value={anim.leanReleaseDelayMsVertical} min={0} max={800} step={10} onChange={setNum("leanReleaseDelayMsVertical")} />
              <Slider label="tilt (deg)" value={anim.leanTiltDeg} min={0} max={30} step={1} onChange={setNum("leanTiltDeg")} />
              <Slider label="squash" value={anim.leanSquash} min={0} max={0.5} step={0.01} onChange={setNum("leanSquash")} />
            </fieldset>

            <Readout
              source={source}
              copied={copied}
              onReset={reset}
              onCopy={copy}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShiftDebug;
