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
type NumKey = "leanReleaseDelayMs" | "leanTiltDeg" | "leanSquash";

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

/**
 * Dev-only harness for tuning the grid-shift animation. Renders the real
 * <Board> on a fixed scene, loops the shift in a chosen direction, and exposes
 * the {@link BoardAnimationConfig} springs/timings as live sliders so the motion
 * can be dialled in without editing code. The JSON readout can be pasted back
 * into DEFAULT_BOARD_ANIMATION once a feel is settled.
 */
const ShiftDebug = ({ onClose }: { onClose: () => void }) => {
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
                board={playing ? shifted : INITIAL}
                winningLine={null}
                onSquareClick={() => {}}
                disabled
                transition={transition}
                animation={anim}
              />
            </div>

            <div className={styles.dpad}>
              {DIRECTIONS.map(({ dir, glyph }) => (
                <button
                  key={dir}
                  type="button"
                  className={classNames(styles.dirButton, styles[dir], {
                    [styles.dirActive]: dir === direction,
                  })}
                  onClick={() => {
                    setDirection(dir);
                    setPlaying(false);
                  }}
                >
                  {glyph}
                </button>
              ))}
            </div>

            <div className={styles.modes}>
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={classNames(styles.modeButton, {
                    [styles.modeActive]: m === mode,
                  })}
                  onClick={() => {
                    setMode(m);
                    setPlaying(false);
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.controls}>
            <fieldset className={styles.group}>
              <legend>Lean spring</legend>
              <Slider label="tension" value={anim.leanSpring.tension} min={50} max={1500} step={10} onChange={setSpring("leanSpring", "tension")} />
              <Slider label="friction" value={anim.leanSpring.friction} min={2} max={60} step={1} onChange={setSpring("leanSpring", "friction")} />
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Slide spring (speed)</legend>
              <Slider label="tension" value={anim.slideSpring.tension} min={50} max={1000} step={10} onChange={setSpring("slideSpring", "tension")} />
              <Slider label="friction" value={anim.slideSpring.friction} min={2} max={60} step={1} onChange={setSpring("slideSpring", "friction")} />
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Release spring (back + fade)</legend>
              <Slider label="tension" value={anim.departSpring.tension} min={50} max={1000} step={10} onChange={setSpring("departSpring", "tension")} />
              <Slider label="friction" value={anim.departSpring.friction} min={2} max={60} step={1} onChange={setSpring("departSpring", "friction")} />
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Lean shape & timing</legend>
              <Slider label="release delay (ms)" value={anim.leanReleaseDelayMs} min={0} max={600} step={10} onChange={setNum("leanReleaseDelayMs")} />
              <Slider label="tilt (deg)" value={anim.leanTiltDeg} min={0} max={30} step={1} onChange={setNum("leanTiltDeg")} />
              <Slider label="squash" value={anim.leanSquash} min={0} max={0.5} step={0.01} onChange={setNum("leanSquash")} />
            </fieldset>

            <div className={styles.readout}>
              <div className={styles.readoutActions}>
                <button
                  type="button"
                  className={styles.resetButton}
                  onClick={() => setAnim(DEFAULT_BOARD_ANIMATION)}
                >
                  Reset to defaults
                </button>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={copy}
                >
                  {copied ? "Copied!" : "Copy config"}
                </button>
              </div>
              <p className={styles.hint}>
                Paste over <code>DEFAULT_BOARD_ANIMATION</code> in
                Board/index.tsx
              </p>
              <pre className={styles.json}>{source}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShiftDebug;
