---
title: DocuLens
emoji: 🔍
colorFrom: emerald
colorTo: teal
sdk: gradio
sdk_version: 6.20.0
python_version: "3.12.12"
app_file: app.py
pinned: false
license: apache-2.0
hardware: zero-gpu
startup_duration_timeout: 30m
models:
  - ATH-MaaS/OvisOCR2
preload_from_hub:
  - ATH-MaaS/OvisOCR2
short_description: Stream structured Markdown from document images and PDFs with an intelligent lens.
---

# DocuLens — Intelligent Document Parsing

A modern image and PDF document parsing demo for
[ATH-MaaS/OvisOCR2](https://huggingface.co/ATH-MaaS/OvisOCR2). It preserves
reading order and emits Markdown with LaTeX formulas, HTML tables, and rendered
visual-region crops. Model tokens stream into the interface as they are generated.
PDFs are rasterized locally and processed one page at a time in Base mode.

## Key features

- **Modern UI** — Card-based layout with emerald/teal design, tabbed output,
  and responsive layout for desktop and mobile.
- **Real-time streaming** — Results appear as the model generates them, with
  smooth progressive rendering.
- **Visual region crops** — Bounding box images are materialized as inline
  data-URI crops in the rendered output.
- **Example gallery** — Five packaged examples covering financial tables,
  Chinese handwriting, and formula-rich research papers.
- **Export** — Download parsed results as Markdown files.
- **Demo mode** — Run without loading the model for UI testing.

## Local run

The verified local model directory is `/root/models/ATH-MaaS/OvisOCR2`.

```bash
pip install -r requirements.txt
CUDA_VISIBLE_DEVICES=0 \
DOCCALENS_MODEL_PATH=/root/models/ATH-MaaS/OvisOCR2 \
python app.py
```

Open `http://127.0.0.1:7860`.

### DSW proxy

The server already listens on `0.0.0.0`. Set a DSW id and the public proxy URL
is generated from the same `PORT` automatically:

```bash
CUDA_VISIBLE_DEVICES=0 \
PORT=7869 \
DOCCALENS_DSW_ID=1976932 \
DOCCALENS_MODEL_PATH=/root/models/ATH-MaaS/OvisOCR2 \
python app.py
```

The corresponding URL is
`https://1976932-proxy-7869.dsw-gateway-cn-hangzhou.data.aliyun.com/`.
For a different gateway or an explicit public URL, set `DOCCALENS_ROOT_PATH`
instead; it takes precedence over `DOCCALENS_DSW_ID`.

For a UI-only smoke that does not load the model:

```bash
DOCCALENS_TEST_MODE=1 python app.py
```

## Hugging Face Space

The checked-in `dist/` directory is the production frontend, so the folder can
be uploaded directly to a Gradio Space without a build step. Select
ZeroGPU hardware in the Space settings. The README metadata pins Python 3.12.12
and Gradio 6.20.0 and declares `hardware: zero-gpu`; `app.py` decorates only the
inference endpoint with `@spaces.GPU` and loads the model on CUDA at module
scope, following the ZeroGPU loading contract.

On Hugging Face, the model source automatically falls back from the local path
to `ATH-MaaS/OvisOCR2`. PDFs are limited to 50 pages by default. Groups of up to
four pages share a ZeroGPU reservation while the frontend preserves already
completed pages.

## Runtime knobs

- `DOCCALENS_MODEL_PATH`: local directory or Hub model id.
- `DOCCALENS_MAX_NEW_TOKENS`: defaults to `16384`, matching the model README inference configuration.
- `DOCCALENS_MAX_PDF_PAGES`: defaults to `50`.
- `DOCCALENS_PAGES_PER_GPU_REQUEST`: defaults to `4` and is capped at `5`.
- `DOCCALENS_PDF_RENDER_SCALE`: PDF rasterization scale, defaults to `2.0`.
- `DOCCALENS_STREAM_MIN_CHARS`: minimum new characters between stream updates, defaults to `64`.
- `DOCCALENS_STREAM_MAX_INTERVAL`: maximum seconds between available stream updates, defaults to `0.25`.
- `DOCCALENS_GPU_SECONDS_PER_PAGE`: duration-estimation budget, defaults to `30` seconds per page.
- `DOCCALENS_GPU_DURATION_FLOOR`: minimum per-group ZeroGPU reservation, defaults to `45` seconds.
- `DOCCALENS_GPU_DURATION_CEILING`: maximum estimated per-group reservation, defaults to `120` seconds.
- `DOCCALENS_GPU_DURATION`: optional fixed per-group override; unset by default so dynamic duration is used.
- `DOCCALENS_ATTN_IMPLEMENTATION`: defaults to `sdpa`.
- `DOCCALENS_DSW_ID`: generates the Hangzhou DSW proxy root using the active `PORT`.
- `DOCCALENS_ROOT_PATH`: explicit proxy URL or ASGI path prefix; overrides `DOCCALENS_DSW_ID`.
- `DOCCALENS_TEST_MODE=1`: deterministic mock inference for UI/integration tests.

## Project structure

```
DocuLens/
├── app.py              # Backend: FastAPI + Gradio server with OCR pipeline
├── requirements.txt    # Python dependencies
├── README.md           # This file
├── .gitattributes      # Git LFS configuration
└── dist/               # Frontend (production build)
    ├── index.html      # Main HTML page
    ├── favicon.ico     # App icon
    ├── brand/          # Brand assets
    │   └── doculens-logo.svg
    ├── assets/         # CSS and JS
    │   ├── style.css   # DocuLens theme (emerald/teal)
    │   └── app.js      # Frontend logic (vanilla JS)
    ├── examples/       # Example documents
    └── vendor/         # MathJax for LaTeX rendering
```

## Architecture

The backend uses the same OCR pipeline as OvisOCR2:

1. **Document loading** — PDFs are rasterized with PyMuPDF at 2x scale; images
   are loaded with PIL and EXIF-transposed.
2. **Model inference** — The `ATH-MaaS/OvisOCR2` model (Qwen3.5-based) processes
   each page image with a structured extraction prompt.
3. **Streaming** — Generated tokens stream via `TextIteratorStreamer` and are
   forwarded to the frontend as SSE events.
4. **Post-processing** — Bounding box image placeholders are materialized as
   data-URI crops; truncated repeats are cleaned.
5. **Frontend** — A vanilla JS client renders results with MathJax for LaTeX,
   marked.js for Markdown, and provides tabbed output with export.


   We thank the authors for making their work publicly available.
