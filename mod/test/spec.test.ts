// spec.ts holds the glyphs, colours, widths and cuts every other module
// reads.  These pin their forms, and hold the colours to what a terminal
// can draw: every 256 value an entry Claude Code's rounding gives back,
// every true value beside it, the dimmed ones readable drawn faint, and
// every ramp rising.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as spec from "../src/spec.ts";

test("glyphs are literals", () => {
  assert.equal(spec.E_TOK, "🧩");
});

test("colours are hex, and an alias is its target's value", () => {
  assert.equal(spec.F_BLU, "#00afff");
  assert.equal(spec.F_SHARE, spec.F_AMB);
});

test("tables are arrays", () => {
  assert.deepEqual(spec.EAW_WIDE[0], [4352, 4447]);
  assert.deepEqual(spec.WIDTH_PROFILES[0].profiles, ["tmux", "iterm"]);
});

// ── The 256-colour palette ──────────────────────────────────────────────
//
// Claude Code's renderer (chalk's ansi256) rounds each channel to the
// nearest of 6 levels as if the cube were evenly spaced, 0, 51, 102, 153,
// 204, 255, while the xterm cube the terminal draws is 0, 95, 135, 175,
// 215, 255; the greys go by a rounding of their own.  That rounding takes
// 95 to the 102 step and 135 to the 153 one.  So a 256 value draws as
// itself only if it is an xterm entry the rounding gives back: a cube
// colour whose channels are all 0, 175, 215 or 255, black, white, or a
// ramp grey from 8 to 178.

type Rgb = readonly [number, number, number];
const CUBE = [0, 95, 135, 175, 215, 255];

/** The index Claude Code's renderer gives rgb under 256 colours. */
function ansi256([r, g, b]: Rgb): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round((r - 8) / 247 * 24) + 232;
  }
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) +
    Math.round(b / 255 * 5);
}

/** The colour the terminal draws for a 256-colour index from 16 up. */
function xterm(i: number): Rgb {
  if (i >= 232) {
    const v = 8 + 10 * (i - 232);
    return [v, v, v];
  }
  const k = i - 16;
  return [CUBE[Math.floor(k / 36)], CUBE[Math.floor(k / 6) % 6], CUBE[k % 6]];
}

// The entries that come back as themselves, by index.
const PALETTE = Array.from({ length: 240 }, (_, k) => k + 16)
  .filter((i) => ansi256(xterm(i)) === i);

/** CIE L*a*b* (D65) of an sRGB colour. */
function lab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function linear(v: number): number {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** CIE76 distance between two sRGB colours. */
const deltaE = (a: Rgb, b: Rgb): number =>
  Math.hypot(...lab(a).map((p, k) => p - lab(b)[k]));

const nearest = (rgb: Rgb): number => PALETTE.reduce((best, i) =>
  deltaE(rgb, xterm(i)) < deltaE(rgb, xterm(best)) ? i : best);

const rgbOf = (hex: string): Rgb => {
  assert.match(hex, /^#[0-9a-f]{6}$/);
  return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as
    unknown as Rgb;
};
const hex = (rgb: Rgb): string =>
  "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

// ── Faint on black ──────────────────────────────────────────────────────
//
// A figure dimmed by its cut or its unit is drawn faint (SGR 2), and a
// terminal draws faint as about half the colour's intensity: xterm and tmux
// halve it, iTerm2 and Ghostty blend it half-way to the background.  On a
// black background that is each channel halved.  The colours a dim figure
// can take must stay readable there.  The floor is the dimmest the user's
// own true colours reached and read (F_RED 255,90,90: 2.32:1 faint), over
// the three reported too dark under tmux (F_ETA 255,0,255: 2.21; F_PNK
// 255,0,175: 2.04; F_RED 215,0,0: 1.63).

// Every name a dimmed figure is drawn in, aliases included: the ramps'
// faint levels (grade), the mag_dim callers, cache_color's green tier, and
// the share columns.  The chat rows' greys are dim by design, not by
// magnitude.  A ramp's bright level is never drawn faint, so none is here.
const DIMMED = ["F_GRN", "F_AMB", "F_RED", "F_TUP", "F_RATE", "F_TDN",
  "F_YEL", "F_PNK", "F_CRM", "F_PRW", "F_ETA", "F_LIM_SESS", "F_LIM_WEEK",
  "F_SHARE"];
const FAINT_FLOOR = 2.3;

/** WCAG contrast ratio of two sRGB colours. */
function contrast(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb): number => {
    const [r, g, bl] = c.map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const faint = (rgb: Rgb): Rgb => rgb.map((v) => v >> 1) as unknown as Rgb;

// ── The colours, by name ────────────────────────────────────────────────

const SOURCE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "spec.ts"), "utf8");
// Every F_ and B_ name, in the order written, and the name each alias is.
const COLOUR_NAMES = [...SOURCE.matchAll(
  /^export const ([FB]_\w+) = (?:"#|[FB]_)/gm)].map((m) => m[1]);
const ALIASES = new Map([...SOURCE.matchAll(
  /^export const ([FB]_\w+) = ([FB]_\w+);/gm)].map((m) => [m[1], m[2]]));
const ALL = spec as unknown as { readonly [name: string]: unknown };
const SETS: { readonly [mode: string]: (name: string) => Rgb } = {
  "256": (name) => rgbOf(ALL[name] as string),
  true: (name) => rgbOf(spec.TRUE_COLOURS[name]),
};

test("the colour names are read", () => {
  assert.ok(COLOUR_NAMES.length > 40);
  assert.equal(ALIASES.get("F_SHARE"), "F_AMB");
  assert.equal(PALETTE.length, 80);
});

test("every 256 value is a palette entry Claude Code's rounding gives back",
  () => {
    for (const name of COLOUR_NAMES) {
      const rgb = SETS["256"](name);
      const i = ansi256(rgb);
      const back = PALETTE.includes(i) && hex(xterm(i)) === hex(rgb);
      assert.ok(back, `${name} ${hex(rgb)} is not on the 256-colour ` +
        `palette, so it draws as ${hex(xterm(i))} under tmux; the nearest ` +
        `entry is ${nearest(rgb)}, "${hex(xterm(nearest(rgb)))}"`);
    }
  });

test("every colour has its true value, an alias its target's", () => {
  assert.deepEqual(Object.keys(spec.TRUE_COLOURS), COLOUR_NAMES);
  for (const name of COLOUR_NAMES) {
    SETS.true(name);
    const target = ALIASES.get(name);
    if (target === undefined) continue;
    assert.equal(spec.TRUE_COLOURS[name], spec.TRUE_COLOURS[target], name);
  }
});

test("a colour a dim figure takes is readable drawn faint on black", () => {
  for (const name of DIMMED) {
    for (const [mode, of] of Object.entries(SETS)) {
      const rgb = of(name);
      const c = contrast(faint(rgb), [0, 0, 0]);
      assert.ok(c >= FAINT_FLOOR, `${name}'s ${mode} value ${hex(rgb)} ` +
        `drawn faint on black is ${c.toFixed(2)}:1, under the ` +
        `${FAINT_FLOOR}:1 floor; pick a lighter one of its hue`);
    }
  }
});

// A ramp resolved in a mode, with adjacent levels that draw the same there
// collapsed, has each level lighter than the one below it.  A level drawn
// faint is drawn at half each channel.
test("every ramp names colours and rises in both sets", () => {
  for (const [hue, levels] of Object.entries(spec.RAMPS)) {
    for (const lv of levels) {
      assert.ok(COLOUR_NAMES.includes(lv.ink), `RAMPS ${hue} names ` +
        `${lv.ink}, which is not a colour`);
    }
    for (const [mode, of] of Object.entries(SETS)) {
      const drawn: Rgb[] = [];
      for (const lv of levels) {
        const d = "faint" in lv && lv.faint ? faint(of(lv.ink)) : of(lv.ink);
        if (!drawn.length || hex(drawn[drawn.length - 1]) !== hex(d)) {
          drawn.push(d);
        }
      }
      for (let k = 1; k < drawn.length; k++) {
        assert.ok(lab(drawn[k])[0] > lab(drawn[k - 1])[0],
          `RAMPS ${hue} in the ${mode} set draws ${hex(drawn[k])} over ` +
          `${hex(drawn[k - 1])}, which is not lighter`);
      }
    }
  }
});
