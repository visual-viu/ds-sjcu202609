'use strict';

/* ==========================================================================
   State
   ========================================================================== */

const state = {
  inputMode: 'image',       // 'text' | 'image'
  text: '',
  imageDataUrl: null,
  resultImage: null,        // base64 PNG returned by the API, once generated
  theme: 'webtoon',
  themeName: '웹툰 스타일',
  fontStyle: 'noto',
  styleIntensity: 'strong', // weak | normal | strong
  effect3d: 'strong',       // off | weak | strong
  background: 'auto',       // transparent | white | black | auto
  ratio: '1.59:1',
  colorMood: 'auto',
  extraPrompt: ''
};

const THEME_NAMES = {
  webtoon: '웹툰 스타일',
  forest: '풀숲 스타일',
  ocean: '바다 스타일',
  glass: '유리 스타일',
  geometric: '도형 스타일'
};

const HISTORY_KEY = 'typoai_history';
const DAILY_DRAW_COUNTER_KEY = 'typoai_daily_draw_counter';
const MAX_HISTORY = 24;
const THUMB_MAX_SIZE = 160;

let isGenerating = false;
let hasResult = false;

/* ==========================================================================
   DOM refs
   ========================================================================== */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const textInput = $('#textInput');
const textCount = $('#textCount');

const drawCanvas = $('#drawCanvas');
const brushCursor = $('#brushCursor');
const undoDrawBtn = $('#undoDrawBtn');
const clearDrawBtn = $('#clearDrawBtn');

const modePanelText = $('#modePanelText');
const modePanelImage = $('#modePanelImage');

const themeGrid = $('#themeGrid');
const fontStyleRow = $('#fontStyleRow');

const extraPromptEl = $('#extraPrompt');

const generateBtn = $('#generateBtn');
const artworkStage = $('#artworkStage');
const artworkEmpty = $('#artworkEmpty');
const artworkText = $('#artworkText');
const artworkImage = $('#artworkImage');
const loadingOverlay = $('#loadingOverlay');
const resultActions = $('#resultActions');
const previewRatioLabel = $('#previewRatioLabel');

const generateAgainBtn = $('#generateAgainBtn');
const newArtworkBtn = $('#newArtworkBtn');
const downloadBtn = $('#downloadBtn');

const historyTrack = $('#historyTrack');
const historyEmpty = $('#historyEmpty');
const clearHistoryBtn = $('#clearHistoryBtn');

/* ==========================================================================
   Toast (lightweight inline feedback)
   ========================================================================== */

let toastTimer = null;
function showToast(message) {
  let toast = $('#toastMsg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastMsg';
    toast.style.cssText = `
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px);
      background: rgba(20,20,26,0.95); color: #f5f5f8; padding: 12px 20px; border-radius: 999px;
      font-size: 0.85rem; font-weight: 600; border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 12px 30px -8px rgba(0,0,0,0.5); z-index: 999; opacity: 0; transition: opacity .2s ease, transform .2s ease;
      pointer-events: none; max-width: 90vw; text-align: center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2200);
}

/* ==========================================================================
   Input mode toggle
   ========================================================================== */

$$('.input-mode-toggle .segmented-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === state.inputMode) return;
    state.inputMode = mode;

    $$('.input-mode-toggle .segmented-btn').forEach(b => {
      b.classList.toggle('is-active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });

    modePanelText.hidden = mode !== 'text';
    modePanelImage.hidden = mode !== 'image';
    fontStyleRow.hidden = mode === 'image';
  });
});

/* ==========================================================================
   Text input
   ========================================================================== */

textInput.addEventListener('input', () => {
  state.text = textInput.value.normalize('NFC');
  textCount.textContent = `${textInput.value.length}/20`;
});

/* ==========================================================================
   Draw pad — freehand character sketch (replaces file upload)
   ========================================================================== */

const drawCtx = drawCanvas.getContext('2d');
let brushSize = 7;
let drawTool = 'pen'; // 'pen' | 'eraser'
let isDrawing = false;
let hasDrawing = false;
let undoStack = [];
const MAX_UNDO = 20;
const PEN_COLOR = '#141418';
const ERASER_COLOR = '#ffffff';

function fillCanvasWhite() {
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function initCanvas() {
  fillCanvasWhite();
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.strokeStyle = '#141418';
}
initCanvas();

function clearCanvas() {
  undoStack = [];
  fillCanvasWhite();
  hasDrawing = false;
}

function getCanvasPoint(e) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (drawCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (drawCanvas.height / rect.height)
  };
}

function pushUndoSnapshot() {
  undoStack.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function currentLineWidth() {
  return drawTool === 'eraser' ? brushSize * 2.5 : brushSize;
}

let lastPointerEvent = null;

function updateBrushCursor(e) {
  lastPointerEvent = e;
  const rect = drawCanvas.getBoundingClientRect();
  const scale = rect.width / drawCanvas.width;
  const sizePx = currentLineWidth() * scale;
  brushCursor.style.width = `${sizePx}px`;
  brushCursor.style.height = `${sizePx}px`;
  brushCursor.style.left = `${e.clientX - rect.left}px`;
  brushCursor.style.top = `${e.clientY - rect.top}px`;
  brushCursor.classList.toggle('is-eraser', drawTool === 'eraser');
}

drawCanvas.addEventListener('pointerdown', (e) => {
  pushUndoSnapshot();
  isDrawing = true;
  hasDrawing = true;
  drawCanvas.setPointerCapture(e.pointerId);
  drawCtx.strokeStyle = drawTool === 'eraser' ? ERASER_COLOR : PEN_COLOR;
  drawCtx.lineWidth = currentLineWidth();
  const p = getCanvasPoint(e);
  drawCtx.beginPath();
  drawCtx.moveTo(p.x, p.y);
  drawCtx.lineTo(p.x + 0.01, p.y + 0.01); // draw a dot on a single tap/click
  drawCtx.stroke();
  drawCtx.beginPath();
  drawCtx.moveTo(p.x, p.y);
  updateBrushCursor(e);
});

drawCanvas.addEventListener('pointermove', (e) => {
  updateBrushCursor(e);
  if (!isDrawing) return;
  const p = getCanvasPoint(e);
  drawCtx.lineTo(p.x, p.y);
  drawCtx.stroke();
  // Start a fresh subpath at the current point instead of appending to the
  // one growing subpath — otherwise stroke() redraws the whole path so far
  // on every move, so lag grows the longer/faster you draw.
  drawCtx.beginPath();
  drawCtx.moveTo(p.x, p.y);
});

drawCanvas.addEventListener('pointerenter', (e) => {
  brushCursor.hidden = false;
  updateBrushCursor(e);
});

drawCanvas.addEventListener('pointerleave', () => {
  brushCursor.hidden = true;
  if (isDrawing) endStroke();
});

function endStroke() { isDrawing = false; }
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);

$$('.draw-brush-toggle .segmented-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    brushSize = Number(btn.dataset.brush);
    $$('.draw-brush-toggle .segmented-btn').forEach(b => b.classList.toggle('is-active', b === btn));
    if (lastPointerEvent) updateBrushCursor(lastPointerEvent);
  });
});

$$('.draw-tool-toggle .segmented-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    drawTool = btn.dataset.tool;
    $$('.draw-tool-toggle .segmented-btn').forEach(b => b.classList.toggle('is-active', b === btn));
    if (lastPointerEvent) updateBrushCursor(lastPointerEvent);
  });
});

clearDrawBtn.addEventListener('click', () => {
  if (!hasDrawing) return;
  pushUndoSnapshot();
  fillCanvasWhite();
  hasDrawing = false;
});

undoDrawBtn.addEventListener('click', () => {
  if (!undoStack.length) return;
  drawCtx.putImageData(undoStack.pop(), 0, 0);
  hasDrawing = undoStack.length > 0;
});

/* ==========================================================================
   Theme selection
   ========================================================================== */

themeGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.theme-card');
  if (!card) return;
  state.theme = card.dataset.theme;
  state.themeName = THEME_NAMES[state.theme];
  $$('.theme-card', themeGrid).forEach(c => c.classList.toggle('is-active', c === card));
});

/* ==========================================================================
   Generic option groups: segmented / swatch-row / ratio-row
   ========================================================================== */

function initOptionGroup(selector, onChange) {
  $$(selector).forEach(group => {
    const optionKey = group.dataset.option;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !group.contains(btn)) return;
      const value = btn.dataset.value;
      if (value === undefined) return;
      state[optionKey] = value;
      Array.from(group.children).forEach(child => {
        if (child.tagName === 'BUTTON') child.classList.toggle('is-active', child === btn);
      });
      if (onChange) onChange(optionKey, value);
    });
  });
}

initOptionGroup('.segmented[data-option]');
initOptionGroup('.swatch-row[data-option]');
initOptionGroup('.font-row[data-option]');
initOptionGroup('.ratio-row[data-option]', (key, value) => {
  if (key === 'ratio') updateStageRatio(value);
});

function updateStageRatio(ratio) {
  const [w, h] = ratio.split(':').map(Number);
  artworkStage.style.aspectRatio = `${w} / ${h}`;
  previewRatioLabel.textContent = ratio;
}

extraPromptEl.addEventListener('input', () => {
  state.extraPrompt = extraPromptEl.value;
});

/* ==========================================================================
   Prompt building
   ========================================================================== */

function buildPrompt(options) {
  const {
    inputType, text, theme, fontStyle,
    styleIntensity, effect3d, background, ratio, colorMood, extraPrompt
  } = options;

  const fontStyleMap = {
    noto: 'a clean, modern sans-serif base font',
    blackhan: 'a bold, high-impact Korean display font (Black Han Sans style)',
    jua: 'a soft, rounded, playful Korean font (Jua style)',
    gaegu: 'a casual handwritten Korean font (Gaegu style)',
    gugi: 'a chunky, graffiti-inspired Korean font (Gugi style)',
    songmyung: 'a traditional Korean brush-calligraphy font (Song Myung style)'
  };

  const themeDescriptions = {
    webtoon: 'a bold Korean webtoon title design with thick outlines, punchy layered drop shadows, and high-impact comic title styling',
    forest: 'a lush grassy meadow background filled with vivid green grass blades and blooming flowers, with the letterforms themselves built from twisting vines, blooming flowers, and tufts of grass',
    ocean: 'an underwater ocean scene background with colorful fish swimming among shafts of light and drifting bubbles, with the letterforms themselves formed from flowing streams and currents of glossy water',
    glass: 'a bright blue sky background with soft clouds, with the letterforms themselves rendered as sparkling clear glass lettering, showing refraction, soft blur, and bright specular light reflections',
    geometric: 'a background tiled with bold geometric shapes such as circles, triangles, bars, and polygons, with the letterforms themselves constructed from and decorated with matching extruded, dimensional geometric shapes'
  };
  const intensityMap = { weak: 'subtle', normal: 'balanced', strong: 'intense and highly pronounced' };
  const effect3dMap = {
    off: 'tasteful three-dimensional depth with soft shadows, gentle extrusion, and dimensional lighting (never perfectly flat)',
    weak: 'soft 3D depth with gentle extrusion',
    strong: 'dramatic 3D extrusion with strong depth, thickness, and perspective'
  };
  const bgMap = {
    transparent: 'a transparent background',
    white: 'a clean white background',
    black: 'a deep black background',
    auto: 'an AI-selected background that best complements the theme'
  };
  const moodMap = {
    auto: 'an AI-recommended color palette',
    bright: 'bright, cheerful colors',
    pastel: 'soft pastel colors',
    vivid: 'highly saturated, vivid colors',
    dark: 'dark, moody tones'
  };

  let subject;
  if (inputType === 'text') {
    const isKorean = /[가-힣]/.test(text);
    const isNumeric = /^[0-9\s]+$/.test(text);
    const lang = isKorean ? 'Korean' : isNumeric ? 'numeric' : 'English';
    subject = `the exact ${lang} word '${text}'`;
  } else {
    subject = `the user's hand-drawn lettering, sketched freehand directly on the canvas, preserving its original character shapes and stroke feel`;
  }

  let prompt = `Create a highly detailed typographic artwork featuring ${subject}. `;
  prompt += `Base the letterforms on ${fontStyleMap[fontStyle]}. `;
  prompt += `Apply ${themeDescriptions[theme]}, with ${intensityMap[styleIntensity]} styling intensity. `;
  prompt += `Render with ${effect3dMap[effect3d]}. `;
  prompt += `Use ${bgMap[background]} and ${moodMap[colorMood]}. `;
  prompt += `Compose for a ${ratio} aspect ratio. `;
  if (extraPrompt && extraPrompt.trim()) {
    prompt += `Additional creative direction: ${extraPrompt.trim()}. `;
  }
  prompt += `Regardless of the theme or settings chosen, always render the piece with maximalist, eye-popping visual richness and pronounced three-dimensional depth — dramatic extrusion, dynamic multi-directional studio lighting, deep cast shadows, glossy specular highlights, and richly saturated, vibrant colors — so the result feels spectacular, premium, and dazzling, never flat, minimal, or plain. `;
  prompt += `The typography must remain the clear focal point of the composition, professionally rendered at print-ready quality.`;

  return prompt;
}

/* ==========================================================================
   AI generation — calls the local /api/generate endpoint (OpenAI gpt-image-1)
   ========================================================================== */

async function generateArtwork(options) {
  const prompt = buildPrompt(options);

  const body = {
    prompt,
    ratio: options.ratio,
    background: options.background
  };
  if (options.inputType === 'image') {
    body.imageDataUrl = state.imageDataUrl;
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `이미지 생성 요청이 실패했습니다 (${res.status})`);
  }
  if (!data.image) {
    throw new Error('서버 응답에 이미지가 없습니다.');
  }

  return {
    success: true,
    image: data.image,
    prompt,
    renderedAt: new Date().toISOString(),
    meta: { ...options }
  };
}

/* ==========================================================================
   Preview rendering
   ========================================================================== */

function applyPreviewFromState() {
  artworkStage.dataset.theme = state.theme;
  artworkStage.dataset.font = state.fontStyle;
  artworkStage.dataset.intensity = state.styleIntensity;
  artworkStage.dataset.effect3d = state.effect3d;
  artworkStage.dataset.mood = state.colorMood;
  artworkStage.dataset.bg = state.background;
  updateStageRatio(state.ratio);

  artworkEmpty.hidden = true;

  if (state.resultImage) {
    artworkStage.classList.add('has-image');
    artworkImage.src = state.resultImage;
    artworkImage.alt = state.inputMode === 'text' ? state.text : '생성된 타이포그래피 아트워크';
    artworkImage.hidden = false;
    artworkText.hidden = true;
    return;
  }

  artworkStage.classList.remove('has-image');

  if (state.inputMode === 'image' && state.imageDataUrl) {
    artworkImage.src = state.imageDataUrl;
    artworkImage.alt = '직접 그린 손글씨';
    artworkImage.hidden = false;
    artworkText.hidden = true;
  } else if (state.inputMode === 'image') {
    artworkText.textContent = '직접 그린 그림 (다시 그려주세요)';
    artworkText.hidden = false;
    artworkImage.hidden = true;
  } else {
    artworkText.textContent = state.text || ' ';
    artworkText.hidden = false;
    artworkImage.hidden = true;
  }
}

function resetPreviewToEmpty() {
  state.resultImage = null;
  artworkStage.classList.remove('has-image');
  artworkEmpty.hidden = false;
  artworkText.hidden = true;
  artworkImage.hidden = true;
  resultActions.hidden = true;
  hasResult = false;
}

/* ==========================================================================
   Generate flow
   ========================================================================== */

function validateBeforeGenerate() {
  if (state.inputMode === 'text') {
    if (!state.text || !state.text.trim()) {
      showToast('이름, 단어, 짧은 문구를 입력해주세요.');
      textInput.focus();
      return false;
    }
  } else {
    if (!hasDrawing) {
      showToast('캔버스에 글자를 직접 그려주세요.');
      return false;
    }
  }
  return true;
}

function currentOptions() {
  return {
    inputType: state.inputMode,
    text: state.text.trim(),
    theme: state.theme,
    themeName: state.themeName,
    fontStyle: state.fontStyle,
    styleIntensity: state.styleIntensity,
    effect3d: state.effect3d,
    background: state.background,
    ratio: state.ratio,
    colorMood: state.colorMood,
    extraPrompt: state.extraPrompt.trim()
  };
}

async function runGeneration() {
  if (isGenerating) return;
  if (!validateBeforeGenerate()) return;

  if (state.inputMode === 'image') {
    state.imageDataUrl = drawCanvas.toDataURL('image/png');
  }

  const hadResultBefore = hasResult;

  isGenerating = true;
  generateBtn.disabled = true;
  generateBtn.classList.add('is-loading');
  artworkEmpty.hidden = true;
  resultActions.hidden = true;
  loadingOverlay.hidden = false;

  const options = currentOptions();

  try {
    const result = await generateArtwork(options);
    state.resultImage = result.image;
    applyPreviewFromState();
    hasResult = true;
    resultActions.hidden = false;
    await addHistoryEntry(options, result.image);
  } catch (err) {
    console.error('[TypoAI] Generation failed', err);
    showToast(err.message || '생성 중 오류가 발생했어요. 다시 시도해주세요.');
    if (hadResultBefore) {
      resultActions.hidden = false;
    } else {
      resetPreviewToEmpty();
    }
  } finally {
    loadingOverlay.hidden = true;
    generateBtn.disabled = false;
    generateBtn.classList.remove('is-loading');
    isGenerating = false;
  }
}

generateBtn.addEventListener('click', runGeneration);
generateAgainBtn.addEventListener('click', runGeneration);

newArtworkBtn.addEventListener('click', () => {
  // Reset inputs but keep the studio open for a fresh creation
  state.text = '';
  state.imageDataUrl = null;
  state.extraPrompt = '';

  textInput.value = '';
  textCount.textContent = '0/20';
  extraPromptEl.value = '';
  clearCanvas();

  resetPreviewToEmpty();
  textInput.focus();
  $('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ==========================================================================
   Download — the finished PNG comes straight from the API, so we can just
   trigger a normal browser download (no export/screenshot step needed).
   ========================================================================== */

downloadBtn.addEventListener('click', () => {
  if (!hasResult || !state.resultImage) {
    showToast('다운로드할 결과가 없어요.');
    return;
  }
  const a = document.createElement('a');
  a.href = state.resultImage;
  a.download = `typoai-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

/* ==========================================================================
   History (localStorage) — stores settings + a small thumbnail per entry.
   The full-resolution image isn't kept (would blow past localStorage
   quotas), so re-selecting a card restores settings and needs a fresh
   Generate to produce the full image again.
   ========================================================================== */

function createThumbnail(dataUrl, maxSize = THUMB_MAX_SIZE) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cctx = c.getContext('2d');
      cctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(c.toDataURL('image/jpeg', 0.72));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[TypoAI] Could not persist history (storage full?)', err);
  }
}

function getDailyDrawingLabel() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let counter = null;
  try {
    counter = JSON.parse(localStorage.getItem(DAILY_DRAW_COUNTER_KEY));
  } catch {
    counter = null;
  }

  const count = counter && counter.date === dateKey ? counter.count + 1 : 1;
  try {
    localStorage.setItem(DAILY_DRAW_COUNTER_KEY, JSON.stringify({ date: dateKey, count }));
  } catch (err) {
    console.warn('[TypoAI] Could not persist daily drawing counter', err);
  }

  return `${now.getMonth() + 1}월 ${now.getDate()}일 작품❤ ${String(count).padStart(2, '0')}`;
}

async function addHistoryEntry(options, resultImage) {
  const thumb = resultImage ? await createThumbnail(resultImage) : null;
  const entry = {
    id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: options.inputType === 'text' ? options.text : getDailyDrawingLabel(),
    inputType: options.inputType,
    theme: options.theme,
    themeName: options.themeName,
    createdAt: Date.now(),
    thumb,
    options
  };

  const list = loadHistory();
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  saveHistory(list);
  renderHistory();
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderHistory() {
  const list = loadHistory();
  historyTrack.innerHTML = '';

  if (!list.length) {
    historyTrack.appendChild(historyEmpty);
    historyEmpty.hidden = false;
    return;
  }

  list.forEach(entry => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'history-card';
    card.title = '클릭하면 이 설정을 다시 불러옵니다';

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'history-delete-btn';
    deleteBtn.setAttribute('role', 'button');
    deleteBtn.setAttribute('tabindex', '0');
    deleteBtn.setAttribute('aria-label', '이 항목 삭제');
    deleteBtn.title = '이 항목 삭제';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryEntry(entry.id);
    });
    deleteBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      deleteHistoryEntry(entry.id);
    });

    const thumb = document.createElement('span');
    thumb.className = `history-thumb theme-thumb thumb-${entry.theme}`;

    if (entry.thumb) {
      thumb.classList.add('has-image');
      const img = document.createElement('img');
      img.src = entry.thumb;
      img.alt = entry.label || '';
      thumb.appendChild(img);
    } else {
      const letterSpan = document.createElement('span');
      letterSpan.className = 'thumb-letter';
      const glyph = entry.inputType === 'text' && entry.label.trim()
        ? [...entry.label.trim()][0]
        : '✏️';
      letterSpan.textContent = glyph;
      thumb.appendChild(letterSpan);
    }

    const info = document.createElement('div');
    info.className = 'history-info';
    info.innerHTML = `
      <p class="h-text">${escapeHtml(entry.label || '(제목 없음)')}</p>
      <div class="h-meta"><span>${THEME_NAMES[entry.theme] || entry.themeName}</span><span>${formatTime(entry.createdAt)}</span></div>
    `;

    card.appendChild(deleteBtn);
    card.appendChild(thumb);
    card.appendChild(info);
    card.addEventListener('click', () => restoreFromHistory(entry));

    historyTrack.appendChild(card);
  });
}

function deleteHistoryEntry(id) {
  const list = loadHistory().filter(entry => entry.id !== id);
  saveHistory(list);
  renderHistory();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function restoreFromHistory(entry) {
  const opts = entry.options;
  state.inputMode = opts.inputType;
  state.text = opts.inputType === 'text' ? opts.text : '';
  state.imageDataUrl = null;
  state.resultImage = null;
  state.theme = opts.theme;
  state.themeName = opts.themeName;
  state.fontStyle = opts.fontStyle || 'noto';
  state.styleIntensity = opts.styleIntensity;
  state.effect3d = opts.effect3d;
  state.background = opts.background;
  state.ratio = opts.ratio;
  state.colorMood = opts.colorMood;
  state.extraPrompt = opts.extraPrompt || '';

  // Sync UI controls to restored state
  $$('.input-mode-toggle .segmented-btn').forEach(b => {
    const active = b.dataset.mode === state.inputMode;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  modePanelText.hidden = state.inputMode !== 'text';
  modePanelImage.hidden = state.inputMode !== 'image';
  fontStyleRow.hidden = state.inputMode === 'image';

  textInput.value = state.text;
  textCount.textContent = `${state.text.length}/20`;
  extraPromptEl.value = state.extraPrompt;

  // The original drawing isn't stored in history — clear the canvas.
  clearCanvas();

  $$('.theme-card', themeGrid).forEach(c => c.classList.toggle('is-active', c.dataset.theme === state.theme));

  syncOptionGroup('[data-option="fontStyle"]', state.fontStyle);
  syncOptionGroup('[data-option="styleIntensity"]', state.styleIntensity);
  syncOptionGroup('[data-option="effect3d"]', state.effect3d);
  syncOptionGroup('[data-option="background"]', state.background);
  syncOptionGroup('[data-option="ratio"]', state.ratio);
  syncOptionGroup('[data-option="colorMood"]', state.colorMood);

  // No full-resolution image is kept in history — show a settings preview
  // and require a fresh Generate to produce the actual artwork again.
  applyPreviewFromState();
  hasResult = false;
  resultActions.hidden = true;

  $('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast('히스토리 설정을 불러왔어요. 제작하기!를 눌러 다시 만들어보세요.');
}

function syncOptionGroup(selector, value) {
  const group = $(selector);
  if (!group) return;
  Array.from(group.children).forEach(child => {
    if (child.tagName === 'BUTTON') child.classList.toggle('is-active', child.dataset.value === value);
  });
  if (selector.includes('ratio')) updateStageRatio(value);
}

clearHistoryBtn.addEventListener('click', () => {
  if (!loadHistory().length) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast('히스토리를 모두 삭제했어요.');
});

/* ==========================================================================
   Init
   ========================================================================== */

updateStageRatio(state.ratio);
renderHistory();
