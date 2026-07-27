"use client";

import {
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
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

type SceneOptions = {
  text: string;
  accent: string;
  theme: ThemeName;
  showCursor: boolean;
  aspect: Aspect;
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
const INTRO_MS = 700;
const OUTRO_MS = 1_200;
const FPS = 30;

function durationFor(text: string, speed: number) {
  return INTRO_MS + Math.max(text.length, 1) * (1_000 / speed) + OUTRO_MS;
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

function drawScene(
  canvas: HTMLCanvasElement,
  elapsed: number,
  speed: number,
  options: SceneOptions,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  const palette = THEMES[options.theme];
  const scale = Math.min(width / 1280, height / 720);
  const typedCount = Math.max(
    0,
    Math.min(options.text.length, Math.floor((elapsed - INTRO_MS) / (1_000 / speed))),
  );
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

  ctx.fillStyle = palette.muted;
  ctx.font = `600 ${Math.max(12, 15 * scale)}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NEW MESSAGE", width / 2, windowY + headerHeight / 2);

  const cardX = windowX + Math.max(24, 48 * scale);
  const cardWidth = windowWidth - Math.max(48, 96 * scale);
  const cardHeight = Math.min(
    Math.max(160, windowHeight * 0.48),
    windowHeight - headerHeight - Math.max(74, 110 * scale),
  );
  const cardY = windowY + headerHeight + Math.max(26, 42 * scale);

  roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 20 * scale);
  ctx.fillStyle = palette.surfaceAlt;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = Math.max(1, scale);
  ctx.stroke();

  const textPadding = Math.max(22, 34 * scale);
  const fontSize = Math.max(
    20,
    Math.min(
      44 * scale,
      options.aspect === "portrait" ? width * 0.055 : width * 0.035,
    ),
  );
  ctx.font = `500 ${fontSize}px Inter, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.ink;
  const lines = wrapText(ctx, typed, cardWidth - textPadding * 2);
  const lineHeight = fontSize * 1.36;
  const maxLines = Math.max(1, Math.floor((cardHeight - textPadding * 2) / lineHeight));
  const visibleLines = lines.slice(-maxLines);
  visibleLines.forEach((line, index) => {
    ctx.fillText(
      line,
      cardX + textPadding,
      cardY + textPadding + index * lineHeight,
    );
  });

  const cursorVisible =
    options.showCursor && (!complete || Math.floor(elapsed / 500) % 2 === 0);
  if (cursorVisible) {
    const currentLine = visibleLines.at(-1) ?? "";
    const cursorX = cardX + textPadding + ctx.measureText(currentLine).width + 3;
    const cursorY =
      cardY + textPadding + Math.max(0, visibleLines.length - 1) * lineHeight;
    ctx.fillStyle = options.accent;
    roundedRect(ctx, cursorX, cursorY + 2, Math.max(3, 4 * scale), fontSize, 2);
    ctx.fill();
  }

  const footerY = windowY + windowHeight - Math.max(48, 70 * scale);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 ${Math.max(11, 14 * scale)}px Inter, Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(
    complete ? "Message ready" : `${typedCount} / ${options.text.length}`,
    cardX,
    footerY,
  );

  const sendSize = Math.max(38, 48 * scale);
  const sendX = windowX + windowWidth - Math.max(24, 42 * scale) - sendSize;
  const sendY = footerY - sendSize / 2;
  const pulse = complete ? 1 + Math.sin(elapsed / 220) * 0.03 : 1;
  ctx.save();
  ctx.translate(sendX + sendSize / 2, sendY + sendSize / 2);
  ctx.scale(pulse, pulse);
  roundedRect(
    ctx,
    -sendSize / 2,
    -sendSize / 2,
    sendSize,
    sendSize,
    sendSize / 2,
  );
  ctx.fillStyle = complete ? options.accent : palette.border;
  ctx.fill();
  ctx.strokeStyle = complete ? palette.surface : palette.muted;
  ctx.lineWidth = Math.max(2, 2.4 * scale);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-sendSize * 0.17, sendSize * 0.08);
  ctx.lineTo(sendSize * 0.16, -sendSize * 0.12);
  ctx.moveTo(sendSize * 0.16, -sendSize * 0.12);
  ctx.lineTo(sendSize * 0.03, sendSize * 0.19);
  ctx.stroke();
  ctx.restore();

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

  const [text, setText] = useState(
    "The smallest idea can become something unforgettable.",
  );
  const [speed, setSpeed] = useState(12);
  const [aspect, setAspect] = useState<Aspect>("landscape");
  const [theme, setTheme] = useState<ThemeName>("midnight");
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [showCursor, setShowCursor] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [exportState, setExportState] = useState<
    "idle" | "exporting" | "done" | "error"
  >("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [notice, setNotice] = useState("");

  const duration = useMemo(() => durationFor(text, speed), [text, speed]);
  const aspectInfo = ASPECTS[aspect];
  const sceneOptions = useMemo<SceneOptions>(
    () => ({ text, accent, theme, showCursor, aspect }),
    [text, accent, theme, showCursor, aspect],
  );

  const paint = useCallback(
    (at: number) => {
      if (canvasRef.current) {
        drawScene(canvasRef.current, at, speed, sceneOptions);
      }
    },
    [sceneOptions, speed],
  );

  useEffect(() => {
    paint(Math.min(elapsed, duration));
  }, [paint, elapsed, duration, aspectInfo.width, aspectInfo.height]);

  useEffect(() => {
    if (!isPlaying) return;

    const tick = (now: number) => {
      const next = elapsedBeforePlayRef.current + (now - startedAtRef.current);
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
  }, [isPlaying, duration]);

  useEffect(() => {
    if (elapsed > duration) {
      setElapsed(duration);
      elapsedBeforePlayRef.current = duration;
    }
  }, [duration, elapsed]);

  const togglePlayback = () => {
    if (isPlaying) {
      elapsedBeforePlayRef.current = elapsed;
      setIsPlaying(false);
      return;
    }
    const startFrom = elapsed >= duration ? 0 : elapsed;
    elapsedBeforePlayRef.current = startFrom;
    setElapsed(startFrom);
    setIsPlaying(true);
  };

  const resetPlayback = () => {
    elapsedBeforePlayRef.current = 0;
    setElapsed(0);
    setIsPlaying(false);
  };

  const seek = (value: number) => {
    elapsedBeforePlayRef.current = value;
    setElapsed(value);
    if (isPlaying) startedAtRef.current = performance.now();
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
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: "avc",
          width: aspectInfo.width,
          height: aspectInfo.height,
          frameRate: FPS,
        },
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
        drawScene(exportCanvas, frameTime, speed, sceneOptions);
        const frame = new VideoFrame(exportCanvas, {
          timestamp,
          duration: Math.round(1_000_000 / FPS),
        });
        encoder.encode(frame, { keyFrame: frameIndex % (FPS * 2) === 0 });
        frame.close();

        if (frameIndex % 18 === 0) {
          setExportProgress(Math.round((frameIndex / totalFrames) * 100));
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 0),
          );
        }
      }

      await encoder.flush();
      encoder.close();
      if (encoderError) throw encoderError;
      muxer.finalize();

      downloadBlob(new Blob([target.buffer], { type: "video/mp4" }), "typeframe.mp4");
      setExportProgress(100);
      setExportState("done");
      setNotice("Your MP4 is ready.");
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
            <span className="eyebrow">02 / FORMAT</span>
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
            <span className="eyebrow">03 / LOOK</span>
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
            <span className="eyebrow">04 / MOTION</span>
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
