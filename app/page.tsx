"use client";

import {
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Globe2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Square,
  SquareTerminal,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Aspect = "landscape" | "square" | "portrait";
type ThemeName = "midnight" | "paper" | "electric";
type PresetName = "terminal" | "website" | "google" | "agent";

type SceneOptions = {
  text: string;
  accent: string;
  theme: ThemeName;
  preset: PresetName;
  showCursor: boolean;
  aspect: Aspect;
};

type CustomClick = {
  name: string;
  samples: Float32Array;
  sampleRate: number;
};

const ASPECTS: Record<
  Aspect,
  { label: string; short: string; width: number; height: number }
> = {
  landscape: { label: "Landscape", short: "16:9", width: 1280, height: 720 },
  square: { label: "Square", short: "1:1", width: 960, height: 960 },
  portrait: { label: "Portrait", short: "9:16", width: 720, height: 1280 },
};

const THEMES: Record<
  ThemeName,
  {
    name: string;
    background: [string, string];
    surface: string;
    surfaceAlt: string;
    ink: string;
    muted: string;
    border: string;
  }
> = {
  midnight: {
    name: "Midnight",
    background: ["#11141b", "#252a38"],
    surface: "#171a22",
    surfaceAlt: "#222631",
    ink: "#f5f6f8",
    muted: "#9298a8",
    border: "#343947",
  },
  paper: {
    name: "Paper",
    background: ["#e9e4da", "#cfc6b7"],
    surface: "#faf7f0",
    surfaceAlt: "#eee8dd",
    ink: "#25221e",
    muted: "#7d766b",
    border: "#d3cabc",
  },
  electric: {
    name: "Electric",
    background: ["#0c1320", "#172945"],
    surface: "#101b2b",
    surfaceAlt: "#17263a",
    ink: "#eef8ff",
    muted: "#7f9fbd",
    border: "#284363",
  },
};

const ACCENTS = ["#ff6948", "#d6ff63", "#77a7ff", "#d291ff", "#f5c451"];
const PRESETS: Array<{
  value: PresetName;
  label: string;
  detail: string;
}> = [
  { value: "terminal", label: "Terminal", detail: "Shell prompt" },
  { value: "website", label: "Website", detail: "Web form" },
  { value: "google", label: "Google", detail: "Search box" },
  { value: "agent", label: "AI Agent", detail: "Prompt composer" },
];
const INTRO_MS = 700;
const OUTRO_MS = 1_200;
const FPS = 30;
const AUDIO_SAMPLE_RATE = 48_000;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashText(text: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function buildTypingTimeline(
  text: string,
  speed: number,
  variation: number,
  rhythmSeed: number,
) {
  const timestamps: number[] = [];
  const baseInterval = 1_000 / speed;
  const intensity = variation / 100;
  const random = seededRandom(hashText(text) ^ rhythmSeed);
  let at = INTRO_MS;

  Array.from(text).forEach((character) => {
    timestamps.push(at);
    const randomGap = 0.32 + random() * 2.08;
    let factor = 1 + (randomGap - 1) * intensity;

    if (character === " ") factor *= 0.62;
    if (/[,.!?;:]/.test(character)) factor *= 2.35;
    if (random() < 0.12) factor += (0.55 + random() * 0.95) * intensity;

    at += baseInterval * Math.max(0.34, factor);
  });

  return timestamps;
}

function typedCountAt(timeline: number[], elapsed: number) {
  let low = 0;
  let high = timeline.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline[middle] <= elapsed) low = middle + 1;
    else high = middle;
  }

  return low;
}

function durationFor(timeline: number[]) {
  return (timeline.at(-1) ?? INTRO_MS) + OUTRO_MS;
}

function makeClickTrack(
  text: string,
  timeline: number[],
  duration: number,
  volume: number,
  customClick: CustomClick | null,
) {
  const totalSamples = Math.ceil((duration / 1_000) * AUDIO_SAMPLE_RATE);
  const samples = new Float32Array(totalSamples);
  const clickLength = customClick
    ? Math.min(
        Math.ceil(
          (customClick.samples.length / customClick.sampleRate) *
            AUDIO_SAMPLE_RATE,
        ),
        AUDIO_SAMPLE_RATE,
      )
    : Math.floor(AUDIO_SAMPLE_RATE * 0.038);

  timeline.forEach((timestamp, keyIndex) => {
    const start = Math.floor((timestamp / 1_000) * AUDIO_SAMPLE_RATE);
    const character = text[keyIndex] ?? "";
    const keyLevel = character === " " ? 0.52 : /[,.!?;:]/.test(character) ? 0.78 : 1;
    const pitch = 1_050 + (keyIndex % 7) * 58;

    for (let offset = 0; offset < clickLength && start + offset < samples.length; offset += 1) {
      let rawSample: number;
      if (customClick) {
        const sourcePosition =
          (offset * customClick.sampleRate) / AUDIO_SAMPLE_RATE;
        const sourceIndex = Math.floor(sourcePosition);
        const mix = sourcePosition - sourceIndex;
        const current = customClick.samples[sourceIndex] ?? 0;
        const next = customClick.samples[sourceIndex + 1] ?? current;
        rawSample = current + (next - current) * mix;
      } else {
        const time = offset / AUDIO_SAMPLE_RATE;
        const envelope = Math.pow(1 - offset / clickLength, 4.2);
        const noiseSeed =
          Math.sin((offset + 1) * (12.9898 + keyIndex * 0.17)) * 43_758.5453;
        const noise = ((noiseSeed - Math.floor(noiseSeed)) * 2 - 1) * 0.68;
        const tone = Math.sin(Math.PI * 2 * pitch * time) * 0.34;
        const thump = Math.sin(Math.PI * 2 * 185 * time) * 0.22;
        rawSample = (noise + tone + thump) * envelope;
      }
      const sample = rawSample * volume * keyLevel;
      samples[start + offset] = Math.max(
        -1,
        Math.min(1, samples[start + offset] + sample),
      );
    }
  });

  return samples;
}

function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1_000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (!paragraph) {
      lines.push("");
      return;
    }

    let line = "";
    Array.from(paragraph).forEach((character) => {
      const candidate = line + character;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    if (paragraphIndex < paragraphs.length - 1 && paragraph) lines.push("");
  });

  return lines;
}

function tailToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  let visible = text.replace(/\n/g, " ");
  while (visible.length > 1 && ctx.measureText(visible).width > maxWidth) {
    visible = visible.slice(1);
  }
  return visible;
}

function drawScene(
  canvas: HTMLCanvasElement,
  elapsed: number,
  timeline: number[],
  options: SceneOptions,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  const palette = THEMES[options.theme];
  const scale = Math.min(width / 1280, height / 720);
  const typedCount = typedCountAt(timeline, elapsed);
  const typed = options.text.slice(0, typedCount);
  const complete = typedCount >= options.text.length;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(1, palette.background[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * 0.78,
    height * 0.18,
    0,
    width * 0.78,
    height * 0.18,
    Math.max(width, height) * 0.72,
  );
  glow.addColorStop(0, `${options.accent}2b`);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const margin = Math.max(34 * scale, Math.min(width, height) * 0.07);
  const windowWidth = width - margin * 2;
  const windowHeight = Math.min(
    height - margin * 2,
    options.aspect === "portrait" ? height * 0.68 : height * 0.76,
  );
  const windowX = margin;
  const windowY = (height - windowHeight) / 2;
  const radius = Math.max(18, 28 * scale);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.32)";
  ctx.shadowBlur = 42 * scale;
  ctx.shadowOffsetY = 18 * scale;
  roundedRect(ctx, windowX, windowY, windowWidth, windowHeight, radius);
  ctx.fillStyle = palette.surface;
  ctx.fill();
  ctx.restore();

  roundedRect(ctx, windowX, windowY, windowWidth, windowHeight, radius);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = Math.max(1, scale * 1.4);
  ctx.stroke();

  const headerHeight = Math.max(64 * scale, Math.min(88, windowHeight * 0.13));
  ctx.save();
  roundedRect(ctx, windowX, windowY, windowWidth, headerHeight, radius);
  ctx.clip();
  ctx.fillStyle = palette.surfaceAlt;
  ctx.fillRect(windowX, windowY, windowWidth, headerHeight + radius);
  ctx.restore();

  const dotSize = Math.max(5, 7 * scale);
  ["#ff6b5d", "#f6c74f", "#68cf78"].forEach((color, index) => {
    ctx.beginPath();
    ctx.arc(
      windowX + 30 * scale + index * 25 * scale,
      windowY + headerHeight / 2,
      dotSize,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
  });

  const cursorVisible =
    options.showCursor && (!complete || Math.floor(elapsed / 500) % 2 === 0);
  const contentTop = windowY + headerHeight;
  const contentHeight = windowHeight - headerHeight;
  const innerPadding = Math.max(24, 44 * scale);
  const baseFontSize = Math.max(
    20,
    Math.min(
      42 * scale,
      options.aspect === "portrait" ? width * 0.052 : width * 0.033,
    ),
  );

  const drawMultilineField = (
    x: number,
    y: number,
    boxWidth: number,
    boxHeight: number,
    config: {
      background: string;
      border: string;
      ink: string;
      font: string;
      radius: number;
      padding: number;
      promptOffset?: number;
      cursorStyle?: "line" | "block";
    },
  ) => {
    roundedRect(ctx, x, y, boxWidth, boxHeight, config.radius);
    ctx.fillStyle = config.background;
    ctx.fill();
    ctx.strokeStyle = config.border;
    ctx.lineWidth = Math.max(1, scale);
    ctx.stroke();

    ctx.font = config.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = config.ink;
    const promptOffset = config.promptOffset ?? 0;
    const lines = wrapText(
      ctx,
      typed,
      boxWidth - config.padding * 2 - promptOffset,
    );
    const lineHeight = baseFontSize * 1.36;
    const maxLines = Math.max(
      1,
      Math.floor((boxHeight - config.padding * 2) / lineHeight),
    );
    const visibleLines = lines.slice(-maxLines);
    visibleLines.forEach((line, index) => {
      ctx.fillText(
        line,
        x + config.padding + promptOffset,
        y + config.padding + index * lineHeight,
      );
    });

    if (cursorVisible) {
      const currentLine = visibleLines.at(-1) ?? "";
      const cursorX =
        x +
        config.padding +
        promptOffset +
        ctx.measureText(currentLine).width +
        3;
      const cursorY =
        y + config.padding + Math.max(0, visibleLines.length - 1) * lineHeight;
      ctx.fillStyle = options.accent;
      roundedRect(
        ctx,
        cursorX,
        cursorY + 2,
        config.cursorStyle === "block"
          ? Math.max(7, baseFontSize * 0.52)
          : Math.max(3, 4 * scale),
        baseFontSize,
        2,
      );
      ctx.fill();
    }
  };

  const drawSingleLineField = (
    x: number,
    y: number,
    fieldWidth: number,
    fieldHeight: number,
    config: {
      background: string;
      border: string;
      ink: string;
      font: string;
      leftPadding: number;
      rightPadding: number;
      radius: number;
    },
  ) => {
    roundedRect(ctx, x, y, fieldWidth, fieldHeight, config.radius);
    ctx.fillStyle = config.background;
    ctx.fill();
    ctx.strokeStyle = config.border;
    ctx.lineWidth = Math.max(1, scale);
    ctx.stroke();
    ctx.font = config.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = config.ink;
    const visibleText = tailToFit(
      ctx,
      typed,
      fieldWidth - config.leftPadding - config.rightPadding,
    );
    ctx.fillText(visibleText, x + config.leftPadding, y + fieldHeight / 2);
    if (cursorVisible) {
      ctx.fillStyle = options.accent;
      roundedRect(
        ctx,
        x + config.leftPadding + ctx.measureText(visibleText).width + 3,
        y + fieldHeight * 0.27,
        Math.max(3, 4 * scale),
        fieldHeight * 0.46,
        2,
      );
      ctx.fill();
    }
  };

  const fillWindowBody = (color: string) => {
    ctx.save();
    roundedRect(ctx, windowX, windowY, windowWidth, windowHeight, radius);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(windowX, contentTop, windowWidth, contentHeight + 1);
    ctx.restore();
  };

  if (options.preset === "terminal") {
    ctx.fillStyle = palette.muted;
    ctx.font = `500 ${Math.max(11, 14 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const terminalTitle = "typeframe@local:~";
    const terminalTitleX = windowX + Math.max(104, 126 * scale);
    const terminalTitleY = windowY + headerHeight / 2;
    ctx.fillText(terminalTitle, terminalTitleX, terminalTitleY);
    const titleWidth = ctx.measureText(terminalTitle).width;
    ctx.fillStyle = options.accent;
    roundedRect(
      ctx,
      terminalTitleX + titleWidth + 7 * scale,
      terminalTitleY - Math.max(6, 8 * scale),
      Math.max(4, 6 * scale),
      Math.max(12, 16 * scale),
      1,
    );
    ctx.fill();

    const cardX = windowX + innerPadding;
    const cardWidth = windowWidth - innerPadding * 2;
    const cardHeight = Math.min(
      Math.max(160, contentHeight * 0.56),
      contentHeight - Math.max(72, 100 * scale),
    );
    const cardY = contentTop + Math.max(24, 38 * scale);
    const textPadding = Math.max(22, 34 * scale);
    drawMultilineField(cardX, cardY, cardWidth, cardHeight, {
      background: palette.surfaceAlt,
      border: palette.border,
      ink: palette.ink,
      font: `500 ${baseFontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`,
      radius: 20 * scale,
      padding: textPadding,
      promptOffset: baseFontSize * 1.05,
      cursorStyle: "block",
    });
    ctx.fillStyle = options.accent;
    ctx.font = `600 ${baseFontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("❯", cardX + textPadding, cardY + textPadding);

    if (!complete) {
      ctx.fillStyle = palette.muted;
      ctx.font = `500 ${Math.max(11, 14 * scale)}px ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${typedCount} / ${options.text.length}`,
        cardX,
        windowY + windowHeight - Math.max(44, 64 * scale),
      );
    }
  } else if (options.preset === "website") {
    const addressX = windowX + Math.max(102, 122 * scale);
    const addressY = windowY + headerHeight * 0.23;
    const addressWidth = windowWidth - (addressX - windowX) - 28 * scale;
    const addressHeight = headerHeight * 0.54;
    roundedRect(ctx, addressX, addressY, addressWidth, addressHeight, addressHeight / 2);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = `500 ${Math.max(9, 12 * scale)}px Inter, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("https://northstar.studio/join", addressX + 18 * scale, addressY + addressHeight / 2);

    fillWindowBody(palette.surface);
    ctx.fillStyle = palette.ink;
    ctx.font = `800 ${Math.max(14, 18 * scale)}px Inter, Arial, sans-serif`;
    ctx.fillText("NORTHSTAR", windowX + innerPadding, contentTop + 38 * scale);
    ctx.fillStyle = palette.muted;
    ctx.font = `500 ${Math.max(10, 13 * scale)}px Inter, Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("About   Work   Contact", windowX + windowWidth - innerPadding, contentTop + 38 * scale);

    ctx.textAlign = "left";
    ctx.fillStyle = palette.ink;
    ctx.font = `700 ${Math.max(28, 54 * scale)}px Inter, Arial, sans-serif`;
    ctx.fillText("Stay in the loop.", windowX + innerPadding, contentTop + contentHeight * 0.34);
    ctx.fillStyle = palette.muted;
    ctx.font = `400 ${Math.max(12, 17 * scale)}px Inter, Arial, sans-serif`;
    ctx.fillText("One thoughtful update, delivered when it matters.", windowX + innerPadding, contentTop + contentHeight * 0.45);

    const inputX = windowX + innerPadding;
    const inputY = contentTop + contentHeight * 0.58;
    const buttonWidth = Math.max(92, 130 * scale);
    const inputWidth = windowWidth - innerPadding * 2 - buttonWidth - 10 * scale;
    const inputHeight = Math.max(54, 68 * scale);
    drawSingleLineField(inputX, inputY, inputWidth, inputHeight, {
      background: palette.surfaceAlt,
      border: palette.border,
      ink: palette.ink,
      font: `500 ${Math.max(16, 22 * scale)}px Inter, Arial, sans-serif`,
      leftPadding: 22 * scale,
      rightPadding: 18 * scale,
      radius: 12 * scale,
    });
    roundedRect(ctx, inputX + inputWidth + 10 * scale, inputY, buttonWidth, inputHeight, 12 * scale);
    ctx.fillStyle = complete ? options.accent : palette.border;
    ctx.fill();
    ctx.fillStyle = complete ? palette.surface : palette.muted;
    ctx.font = `700 ${Math.max(11, 14 * scale)}px Inter, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("SUBMIT →", inputX + inputWidth + 10 * scale + buttonWidth / 2, inputY + inputHeight / 2);
  } else if (options.preset === "google") {
    const addressX = windowX + Math.max(102, 122 * scale);
    const addressY = windowY + headerHeight * 0.23;
    const addressWidth = windowWidth - (addressX - windowX) - 28 * scale;
    const addressHeight = headerHeight * 0.54;
    roundedRect(ctx, addressX, addressY, addressWidth, addressHeight, addressHeight / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#d8dadd";
    ctx.stroke();
    ctx.fillStyle = "#5f6368";
    ctx.font = `500 ${Math.max(9, 12 * scale)}px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("https://www.google.com", addressX + 18 * scale, addressY + addressHeight / 2);

    fillWindowBody("#ffffff");
    const googleY = contentTop + contentHeight * 0.31;
    const googleSize = Math.max(42, 70 * scale);
    ctx.font = `600 ${googleSize}px Arial, sans-serif`;
    ctx.textAlign = "left";
    const googleLetters = [
      ["G", "#4285f4"],
      ["o", "#ea4335"],
      ["o", "#fbbc05"],
      ["g", "#4285f4"],
      ["l", "#34a853"],
      ["e", "#ea4335"],
    ] as const;
    const googleWidth = googleLetters.reduce(
      (sum, [letter]) => sum + ctx.measureText(letter).width,
      0,
    );
    let letterX = windowX + windowWidth / 2 - googleWidth / 2;
    googleLetters.forEach(([letter, color]) => {
      ctx.fillStyle = color;
      ctx.fillText(letter, letterX, googleY);
      letterX += ctx.measureText(letter).width;
    });

    const searchWidth = windowWidth * 0.72;
    const searchHeight = Math.max(54, 66 * scale);
    const searchX = windowX + (windowWidth - searchWidth) / 2;
    const searchY = contentTop + contentHeight * 0.5;
    drawSingleLineField(searchX, searchY, searchWidth, searchHeight, {
      background: "#ffffff",
      border: "#dfe1e5",
      ink: "#202124",
      font: `400 ${Math.max(16, 21 * scale)}px Arial, sans-serif`,
      leftPadding: 54 * scale,
      rightPadding: 24 * scale,
      radius: searchHeight / 2,
    });
    ctx.strokeStyle = "#5f6368";
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.beginPath();
    ctx.arc(searchX + 25 * scale, searchY + searchHeight / 2 - 2 * scale, 8 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(searchX + 31 * scale, searchY + searchHeight / 2 + 4 * scale);
    ctx.lineTo(searchX + 37 * scale, searchY + searchHeight / 2 + 10 * scale);
    ctx.stroke();

    const googleButtonY = searchY + searchHeight + 28 * scale;
    ["Google Search", "I'm Feeling Lucky"].forEach((label, index) => {
      const buttonWidth = Math.max(110, 146 * scale);
      const buttonX =
        windowX +
        windowWidth / 2 +
        (index === 0 ? -buttonWidth - 6 * scale : 6 * scale);
      roundedRect(ctx, buttonX, googleButtonY, buttonWidth, 40 * scale, 5 * scale);
      ctx.fillStyle = "#f8f9fa";
      ctx.fill();
      ctx.fillStyle = "#3c4043";
      ctx.font = `500 ${Math.max(9, 12 * scale)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(label, buttonX + buttonWidth / 2, googleButtonY + 20 * scale);
    });
  } else {
    ctx.fillStyle = palette.muted;
    ctx.font = `600 ${Math.max(10, 13 * scale)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("TYPEFRAME AGENT", windowX + Math.max(104, 126 * scale), windowY + headerHeight / 2);
    ctx.beginPath();
    ctx.arc(windowX + windowWidth - 32 * scale, windowY + headerHeight / 2, 5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = "#68cf78";
    ctx.fill();

    const agentPadding = innerPadding;
    fillWindowBody(palette.surface);
    ctx.fillStyle = palette.muted;
    ctx.font = `700 ${Math.max(9, 12 * scale)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("ACTIVE WORKSPACE / TASK 01", windowX + agentPadding, contentTop + 34 * scale);

    const chipY = contentTop + 64 * scale;
    ["RESEARCH", "WRITE", "REVIEW"].forEach((label, index) => {
      const chipWidth = Math.max(70, 94 * scale);
      const chipX = windowX + agentPadding + index * (chipWidth + 8 * scale);
      roundedRect(ctx, chipX, chipY, chipWidth, 28 * scale, 14 * scale);
      ctx.fillStyle = index === 0 ? `${options.accent}25` : palette.surfaceAlt;
      ctx.fill();
      ctx.fillStyle = index === 0 ? options.accent : palette.muted;
      ctx.font = `700 ${Math.max(7, 9 * scale)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(label, chipX + chipWidth / 2, chipY + 14 * scale);
    });

    const composerX = windowX + agentPadding;
    const composerY = contentTop + Math.max(106, 132 * scale);
    const composerWidth = windowWidth - agentPadding * 2;
    const composerHeight = Math.min(
      Math.max(150, contentHeight * 0.43),
      contentHeight - Math.max(160, 190 * scale),
    );
    ctx.fillStyle = palette.muted;
    ctx.font = `600 ${Math.max(9, 12 * scale)}px Inter, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("What should the agent do?", composerX, composerY - 18 * scale);
    drawMultilineField(composerX, composerY, composerWidth, composerHeight, {
      background: palette.surfaceAlt,
      border: complete ? options.accent : palette.border,
      ink: palette.ink,
      font: `500 ${baseFontSize}px Inter, Arial, sans-serif`,
      radius: 18 * scale,
      padding: Math.max(20, 30 * scale),
    });

    const statusY = composerY + composerHeight + 34 * scale;
    ctx.beginPath();
    ctx.arc(composerX + 5 * scale, statusY, 5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = complete ? options.accent : "#68cf78";
    ctx.fill();
    ctx.fillStyle = palette.muted;
    ctx.font = `500 ${Math.max(9, 12 * scale)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText(complete ? "TASK QUEUED" : "AGENT READY", composerX + 18 * scale, statusY);
  }

  ctx.fillStyle = `${palette.ink}a6`;
  ctx.font = `600 ${Math.max(9, 11 * scale)}px Inter, Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("MADE WITH TYPEFRAME", width - margin, height - margin * 0.45);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const elapsedBeforePlayRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastSoundIndexRef = useRef(0);
  const customClickRef = useRef<CustomClick | null>(null);

  const [text, setText] = useState(
    "The smallest idea can become something unforgettable.",
  );
  const [speed, setSpeed] = useState(12);
  const [rhythmVariation, setRhythmVariation] = useState(78);
  const [rhythmSeed, setRhythmSeed] = useState(7_319);
  const [aspect, setAspect] = useState<Aspect>("landscape");
  const [preset, setPreset] = useState<PresetName>("terminal");
  const [theme, setTheme] = useState<ThemeName>("midnight");
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [showCursor, setShowCursor] = useState(true);
  const [keySound, setKeySound] = useState(true);
  const [keySoundLevel, setKeySoundLevel] = useState(32);
  const [customClickName, setCustomClickName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [exportState, setExportState] = useState<
    "idle" | "exporting" | "done" | "error"
  >("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [notice, setNotice] = useState("");

  const typingTimeline = useMemo(
    () => buildTypingTimeline(text, speed, rhythmVariation, rhythmSeed),
    [text, speed, rhythmVariation, rhythmSeed],
  );
  const duration = useMemo(() => durationFor(typingTimeline), [typingTimeline]);
  const aspectInfo = ASPECTS[aspect];
  const sceneOptions = useMemo<SceneOptions>(
    () => ({ text, accent, theme, preset, showCursor, aspect }),
    [text, accent, theme, preset, showCursor, aspect],
  );

  const paint = useCallback(
    (at: number) => {
      if (canvasRef.current) {
        drawScene(canvasRef.current, at, typingTimeline, sceneOptions);
      }
    },
    [sceneOptions, typingTimeline],
  );

  const playKeyClick = useCallback(
    (keyIndex: number) => {
      const audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state !== "running" || !keySound) return;

      const character = text[keyIndex] ?? "";
      const keyLevel = character === " " ? 0.5 : /[,.!?;:]/.test(character) ? 0.76 : 1;
      const customClick = customClickRef.current;
      const source = audioContext.createBufferSource();

      if (customClick) {
        const buffer = audioContext.createBuffer(
          1,
          customClick.samples.length,
          customClick.sampleRate,
        );
        buffer.copyToChannel(customClick.samples, 0);
        const gain = audioContext.createGain();
        gain.gain.value = (keySoundLevel / 100) * keyLevel;
        source.buffer = buffer;
        source.connect(gain).connect(audioContext.destination);
      } else {
        const clickDuration = 0.038;
        const sampleCount = Math.floor(audioContext.sampleRate * clickDuration);
        const buffer = audioContext.createBuffer(
          1,
          sampleCount,
          audioContext.sampleRate,
        );
        const data = buffer.getChannelData(0);
        const pitch = 1_050 + (keyIndex % 7) * 58;

        for (let index = 0; index < sampleCount; index += 1) {
          const time = index / audioContext.sampleRate;
          const envelope = Math.pow(1 - index / sampleCount, 4.2);
          const noiseSeed =
            Math.sin((index + 1) * (12.9898 + keyIndex * 0.17)) *
            43_758.5453;
          const noise = ((noiseSeed - Math.floor(noiseSeed)) * 2 - 1) * 0.68;
          const tone = Math.sin(Math.PI * 2 * pitch * time) * 0.34;
          const thump = Math.sin(Math.PI * 2 * 185 * time) * 0.22;
          data[index] =
            (noise + tone + thump) *
            envelope *
            (keySoundLevel / 100) *
            keyLevel;
        }

        const filter = audioContext.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 150;
        source.buffer = buffer;
        source.connect(filter).connect(audioContext.destination);
      }

      source.start();
    },
    [keySound, keySoundLevel, text],
  );

  useEffect(() => {
    paint(Math.min(elapsed, duration));
  }, [paint, elapsed, duration, aspectInfo.width, aspectInfo.height]);

  useEffect(() => {
    if (!isPlaying) return;

    const tick = (now: number) => {
      const next = elapsedBeforePlayRef.current + (now - startedAtRef.current);
      const nextSoundIndex = typedCountAt(typingTimeline, next);
      if (nextSoundIndex > lastSoundIndexRef.current) {
        for (
          let index = lastSoundIndexRef.current;
          index < nextSoundIndex;
          index += 1
        ) {
          playKeyClick(index);
        }
        lastSoundIndexRef.current = nextSoundIndex;
      }
      if (next >= duration) {
        setElapsed(duration);
        elapsedBeforePlayRef.current = duration;
        setIsPlaying(false);
        return;
      }
      setElapsed(next);
      animationRef.current = requestAnimationFrame(tick);
    };

    startedAtRef.current = performance.now();
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, duration, playKeyClick, typingTimeline]);

  useEffect(
    () => () => {
      const audioContext = audioContextRef.current;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
    },
    [],
  );

  useEffect(() => {
    if (elapsed > duration) {
      setElapsed(duration);
      elapsedBeforePlayRef.current = duration;
    }
  }, [duration, elapsed]);

  const togglePlayback = async () => {
    if (isPlaying) {
      elapsedBeforePlayRef.current = elapsed;
      setIsPlaying(false);
      return;
    }
    const startFrom = elapsed >= duration ? 0 : elapsed;
    if (keySound) {
      if (
        !audioContextRef.current ||
        audioContextRef.current.state === "closed"
      ) {
        audioContextRef.current = new AudioContext();
      }
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
    }
    lastSoundIndexRef.current = typedCountAt(typingTimeline, startFrom);
    elapsedBeforePlayRef.current = startFrom;
    setElapsed(startFrom);
    setIsPlaying(true);
  };

  const resetPlayback = () => {
    elapsedBeforePlayRef.current = 0;
    lastSoundIndexRef.current = 0;
    setElapsed(0);
    setIsPlaying(false);
  };

  const seek = (value: number) => {
    elapsedBeforePlayRef.current = value;
    lastSoundIndexRef.current = typedCountAt(typingTimeline, value);
    setElapsed(value);
    if (isPlaying) startedAtRef.current = performance.now();
  };

  const handleClickUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (file.size > 3 * 1_024 * 1_024) {
      setNotice("Choose an audio file smaller than 3 MB.");
      return;
    }

    try {
      if (
        !audioContextRef.current ||
        audioContextRef.current.state === "closed"
      ) {
        audioContextRef.current = new AudioContext();
      }
      const decoded = await audioContextRef.current.decodeAudioData(
        await file.arrayBuffer(),
      );
      const sampleCount = Math.min(
        decoded.length,
        Math.floor(decoded.sampleRate),
      );
      const monoSamples = new Float32Array(sampleCount);

      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const channelData = decoded.getChannelData(channel);
        for (let index = 0; index < sampleCount; index += 1) {
          monoSamples[index] +=
            channelData[index] / decoded.numberOfChannels;
        }
      }

      customClickRef.current = {
        name: file.name,
        samples: monoSamples,
        sampleRate: decoded.sampleRate,
      };
      setCustomClickName(file.name);
      setKeySound(true);
      resetPlayback();
      setNotice("Custom click loaded. Press play to hear it.");
    } catch {
      setNotice(
        "That audio file could not be decoded. Try WAV, MP3, M4A, OGG, or WebM.",
      );
    }
  };

  const removeCustomClick = () => {
    customClickRef.current = null;
    setCustomClickName("");
    resetPlayback();
    setNotice("Using the built-in keyboard click.");
  };

  const exportMp4 = async () => {
    if (!("VideoEncoder" in window) || !("VideoFrame" in window)) {
      setNotice("This browser cannot encode MP4. Try the latest Chrome or Edge.");
      setExportState("error");
      return;
    }

    setIsPlaying(false);
    setExportState("exporting");
    setExportProgress(0);
    setNotice("");

    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = aspectInfo.width;
      exportCanvas.height = aspectInfo.height;
      const audioConfig: AudioEncoderConfig = {
        codec: "mp4a.40.2",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfChannels: 1,
        bitrate: 128_000,
      };
      if (
        keySound &&
        (!("AudioEncoder" in window) || !("AudioData" in window))
      ) {
        throw new Error(
          "This browser cannot add keyboard audio to MP4. Try the latest Chrome or Edge.",
        );
      }
      if (keySound) {
        const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
        if (!audioSupport.supported) {
          throw new Error("AAC keyboard audio is not supported in this browser.");
        }
      }

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: "avc",
          width: aspectInfo.width,
          height: aspectInfo.height,
          frameRate: FPS,
        },
        audio: keySound
          ? {
              codec: "aac",
              numberOfChannels: 1,
              sampleRate: AUDIO_SAMPLE_RATE,
            }
          : undefined,
        fastStart: "in-memory",
      });
      const config: VideoEncoderConfig = {
        codec: "avc1.42001f",
        width: aspectInfo.width,
        height: aspectInfo.height,
        bitrate: aspect === "landscape" ? 6_000_000 : 5_000_000,
        framerate: FPS,
        avc: { format: "avc" },
      };
      const support = await VideoEncoder.isConfigSupported(config);
      if (!support.supported) {
        throw new Error("H.264 encoding is not supported in this browser.");
      }

      let encoderError: Error | null = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (error) => {
          encoderError = error;
        },
      });
      encoder.configure(config);

      const totalFrames = Math.ceil((duration / 1_000) * FPS);
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        const timestamp = Math.round((frameIndex / FPS) * 1_000_000);
        const frameTime = (frameIndex / FPS) * 1_000;
        drawScene(exportCanvas, frameTime, typingTimeline, sceneOptions);
        const frame = new VideoFrame(exportCanvas, {
          timestamp,
          duration: Math.round(1_000_000 / FPS),
        });
        encoder.encode(frame, { keyFrame: frameIndex % (FPS * 2) === 0 });
        frame.close();

        if (frameIndex % 18 === 0) {
          setExportProgress(Math.round((frameIndex / totalFrames) * 88));
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 0),
          );
        }
      }

      await encoder.flush();
      encoder.close();
      if (encoderError) throw encoderError;

      if (keySound) {
        const audioSamples = makeClickTrack(
          text,
          typingTimeline,
          duration,
          keySoundLevel / 100,
          customClickRef.current,
        );
        let audioEncoderError: Error | null = null;
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (error) => {
            audioEncoderError = error;
          },
        });
        audioEncoder.configure(audioConfig);

        const audioChunkSize = 1_024;
        for (
          let sampleOffset = 0;
          sampleOffset < audioSamples.length;
          sampleOffset += audioChunkSize
        ) {
          const numberOfFrames = Math.min(
            audioChunkSize,
            audioSamples.length - sampleOffset,
          );
          const audioData = new AudioData({
            format: "f32",
            sampleRate: AUDIO_SAMPLE_RATE,
            numberOfFrames,
            numberOfChannels: 1,
            timestamp: Math.round(
              (sampleOffset / AUDIO_SAMPLE_RATE) * 1_000_000,
            ),
            data: audioSamples.subarray(
              sampleOffset,
              sampleOffset + numberOfFrames,
            ),
          });
          audioEncoder.encode(audioData);
          audioData.close();

          if (sampleOffset % (audioChunkSize * 80) === 0) {
            setExportProgress(
              88 + Math.round((sampleOffset / audioSamples.length) * 11),
            );
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, 0),
            );
          }
        }

        await audioEncoder.flush();
        audioEncoder.close();
        if (audioEncoderError) throw audioEncoderError;
      }

      muxer.finalize();

      downloadBlob(new Blob([target.buffer], { type: "video/mp4" }), "typeframe.mp4");
      setExportProgress(100);
      setExportState("done");
      setNotice(
        keySound
          ? "Your MP4 is ready—with keyboard audio."
          : "Your silent MP4 is ready.",
      );
      window.setTimeout(() => setExportState("idle"), 2_000);
    } catch (error) {
      setExportState("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "The MP4 could not be created.",
      );
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Typeframe home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>Typeframe</span>
          <span className="beta">BETA</span>
        </a>
        <div className="topbar-actions">
          <button className="help-button" type="button" aria-label="Help">
            <CircleHelp size={18} strokeWidth={1.8} />
          </button>
          <button
            className="export-button"
            type="button"
            onClick={exportMp4}
            disabled={exportState === "exporting" || !text.trim()}
          >
            {exportState === "exporting" ? (
              <Square size={14} fill="currentColor" />
            ) : exportState === "done" ? (
              <Check size={17} />
            ) : (
              <Download size={17} />
            )}
            <span>
              {exportState === "exporting"
                ? `Rendering ${exportProgress}%`
                : exportState === "done"
                  ? "Downloaded"
                  : "Export MP4"}
            </span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="editor-panel">
          <section className="panel-section script-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">01 / MESSAGE</span>
                <h1>Write your scene</h1>
              </div>
              <Sparkles size={18} strokeWidth={1.7} />
            </div>
            <label className="sr-only" htmlFor="script">
              Text to animate
            </label>
            <textarea
              id="script"
              value={text}
              maxLength={220}
              onChange={(event) => {
                setText(event.target.value);
                resetPlayback();
              }}
              placeholder="Type something worth watching..."
            />
            <div className="text-meta">
              <span>{text.length}/220</span>
              <span>{formatTime(duration)} video</span>
            </div>
          </section>

          <section className="panel-section">
            <span className="eyebrow">02 / INTERFACE</span>
            <div className="preset-grid">
              {PRESETS.map(({ value, label, detail }) => (
                <button
                  type="button"
                  key={value}
                  className={
                    preset === value ? "preset-card selected" : "preset-card"
                  }
                  onClick={() => {
                    setPreset(value);
                    resetPlayback();
                  }}
                  aria-pressed={preset === value}
                >
                  <span className="preset-icon">
                    {value === "terminal" ? (
                      <SquareTerminal size={16} />
                    ) : value === "website" ? (
                      <Globe2 size={16} />
                    ) : value === "google" ? (
                      <Search size={16} />
                    ) : (
                      <Bot size={16} />
                    )}
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <span className="eyebrow">03 / FORMAT</span>
            <div className="aspect-grid">
              {(Object.keys(ASPECTS) as Aspect[]).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={aspect === value ? "aspect-card selected" : "aspect-card"}
                  onClick={() => {
                    setAspect(value);
                    resetPlayback();
                  }}
                  aria-pressed={aspect === value}
                >
                  <span className={`ratio-shape ${value}`} />
                  <strong>{ASPECTS[value].short}</strong>
                  <small>{ASPECTS[value].label}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <span className="eyebrow">04 / LOOK</span>
            <div className="theme-row">
              {(Object.keys(THEMES) as ThemeName[]).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={theme === value ? "theme-chip selected" : "theme-chip"}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                >
                  <span className={`theme-swatch ${value}`} />
                  {THEMES[value].name}
                </button>
              ))}
            </div>
            <div className="field-row">
              <span>Accent</span>
              <div className="color-row" aria-label="Accent color">
                {ACCENTS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={accent === color ? "color-dot selected" : "color-dot"}
                    style={{ "--dot": color } as React.CSSProperties}
                    onClick={() => setAccent(color)}
                    aria-label={`Use ${color} accent`}
                    aria-pressed={accent === color}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="panel-section motion-section">
            <span className="eyebrow">05 / MOTION</span>
            <div className="range-heading">
              <label htmlFor="speed">Typing speed</label>
              <output>{speed} chars/sec</output>
            </div>
            <input
              id="speed"
              type="range"
              min="6"
              max="20"
              value={speed}
              onChange={(event) => {
                setSpeed(Number(event.target.value));
                resetPlayback();
              }}
              style={{ "--range": `${((speed - 6) / 14) * 100}%` } as React.CSSProperties}
            />
            <div className="range-heading secondary-range">
              <label htmlFor="rhythm">Random rhythm</label>
              <output>{rhythmVariation}% range</output>
            </div>
            <input
              id="rhythm"
              type="range"
              min="0"
              max="100"
              value={rhythmVariation}
              onChange={(event) => {
                setRhythmVariation(Number(event.target.value));
                resetPlayback();
              }}
              style={{ "--range": `${rhythmVariation}%` } as React.CSSProperties}
            />
            <div className="rhythm-tools">
              <span>Every key gets a unique time gap</span>
              <button
                type="button"
                onClick={() => {
                  setRhythmSeed((current) => (current + 0x9e3779b9) >>> 0);
                  resetPlayback();
                }}
              >
                <Shuffle size={12} />
                Shuffle timing
              </button>
            </div>
            <label className="toggle-row">
              <span>
                <strong>Cursor blink</strong>
                <small>Keep the caret visible while typing</small>
              </span>
              <input
                type="checkbox"
                checked={showCursor}
                onChange={(event) => setShowCursor(event.target.checked)}
              />
              <span className="toggle" aria-hidden="true" />
            </label>
            <label className="toggle-row compact-toggle">
              <span>
                <strong className="sound-label">
                  <Volume2 size={13} />
                  Key click sound
                </strong>
                <small>Included in preview and MP4 export</small>
              </span>
              <input
                type="checkbox"
                checked={keySound}
                onChange={(event) => setKeySound(event.target.checked)}
              />
              <span className="toggle" aria-hidden="true" />
            </label>
            <div className={keySound ? "sound-volume" : "sound-volume disabled"}>
              <div className="range-heading compact-range">
                <label htmlFor="key-volume">Click volume</label>
                <output>{keySoundLevel}%</output>
              </div>
              <input
                id="key-volume"
                type="range"
                min="10"
                max="60"
                disabled={!keySound}
                value={keySoundLevel}
                onChange={(event) => setKeySoundLevel(Number(event.target.value))}
                style={
                  {
                    "--range": `${((keySoundLevel - 10) / 50) * 100}%`,
                  } as React.CSSProperties
                }
              />
              <div className="click-upload">
                <input
                  className="sr-only"
                  id="click-sound-file"
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
                  onChange={handleClickUpload}
                />
                <label htmlFor="click-sound-file">
                  <Upload size={13} />
                  {customClickName ? "Replace sound" : "Upload your click"}
                </label>
                <small>WAV, MP3, M4A, OGG or WebM · 3 MB max</small>
              </div>
              {customClickName ? (
                <div className="custom-sound">
                  <span className="sound-wave" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <span title={customClickName}>{customClickName}</span>
                  <button
                    type="button"
                    onClick={removeCustomClick}
                    aria-label="Remove custom click sound"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="stage">
          <div className="stage-toolbar">
            <div>
              <span className="live-dot" />
              Live canvas
            </div>
            <button type="button" className="resolution-button">
              {aspectInfo.width} × {aspectInfo.height}
              <ChevronDown size={14} />
            </button>
          </div>

          <div className={`canvas-wrap ${aspect}`}>
            <canvas
              ref={canvasRef}
              width={aspectInfo.width}
              height={aspectInfo.height}
              aria-label="Animated typing video preview"
            />
          </div>

          <div className="transport">
            <div className="transport-main">
              <button
                className="icon-button"
                type="button"
                onClick={resetPlayback}
                aria-label="Restart preview"
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="play-button"
                type="button"
                onClick={togglePlayback}
                aria-label={isPlaying ? "Pause preview" : "Play preview"}
              >
                {isPlaying ? (
                  <Pause size={19} fill="currentColor" />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </button>
              <span className="timecode">
                {formatTime(elapsed)}
                <i>/</i>
                {formatTime(duration)}
              </span>
              <input
                className="timeline"
                aria-label="Video timeline"
                type="range"
                min="0"
                max={duration}
                value={Math.min(elapsed, duration)}
                onChange={(event) => seek(Number(event.target.value))}
                style={
                  {
                    "--range": `${duration ? (elapsed / duration) * 100 : 0}%`,
                  } as React.CSSProperties
                }
              />
            </div>
            <div className="quality-pill">
              <span>30 FPS</span>
              <span>H.264</span>
            </div>
          </div>

          <div className={`notice ${notice ? "visible" : ""}`} role="status">
            {notice}
          </div>
        </section>
      </div>
    </main>
  );
}
