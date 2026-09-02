require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const RATIO_TO_SIZE = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '16:9': '1536x1024',
  '1.59:1': '1536x1024'
};

const BG_TO_PARAM = {
  transparent: 'transparent',
  white: 'opaque',
  black: 'opaque',
  auto: 'auto'
};

function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  const [, mime, b64] = match;
  return new Blob([Buffer.from(b64, 'base64')], { type: mime });
}

app.post('/api/generate', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.' });
  }

  const { prompt, ratio, background, imageDataUrl } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt가 필요합니다.' });
  }

  const size = RATIO_TO_SIZE[ratio] || '1024x1024';
  const bgParam = BG_TO_PARAM[background] || 'auto';

  try {
    let openaiRes;

    if (imageDataUrl) {
      // Hand-drawn input: use the edits endpoint so the sketch guides the result.
      const blob = dataUrlToBlob(imageDataUrl);
      if (!blob) {
        return res.status(400).json({ error: '잘못된 이미지 데이터입니다.' });
      }
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', size);
      form.append('quality', 'high');
      form.append('background', bgParam);
      form.append('image', blob, 'sketch.png');

      openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
      });
    } else {
      openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size,
          background: bgParam,
          quality: 'high'
        })
      });
    }

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      const message = data?.error?.message || `OpenAI API 오류 (${openaiRes.status})`;
      return res.status(openaiRes.status).json({ error: message });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(502).json({ error: 'OpenAI 응답에 이미지가 없습니다.' });
    }

    return res.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error('[TypoAI] Image generation failed', err);
    return res.status(500).json({ error: '이미지 생성 중 오류가 발생했습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`TypoAI server running at http://localhost:${PORT}`);
});
