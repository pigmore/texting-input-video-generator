# Typeframe

Typeframe is a browser-based text animation studio. Write a message, preview
the typing motion on canvas, choose a format and visual theme, then render the
result locally as an H.264 MP4.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

MP4 export uses the browser's WebCodecs H.264 encoder. The latest versions of
Chrome and Edge provide the best support.
