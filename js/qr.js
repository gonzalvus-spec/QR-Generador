/* ============================================================
   QR Studio — Motor de generación y personalización de QR
   Todo el procesamiento ocurre en el navegador.
   ============================================================ */

(() => {
    'use strict';

    if (!window.qrcode) {
        console.error('No se pudo cargar el generador de QR.');
        return;
    }

    // Soporte completo de UTF-8 (acentos, emojis, etc.)
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

    const PREVIEW_SIZE = 1024;
    const MASK_RES = 512;

    const state = {
        type: 'url',
        url: 'https://ejemplo.com',
        text: '',
        wifiSsid: '',
        wifiPass: '',
        wifiEnc: 'WPA',
        wifiHidden: false,
        ecc: 'H',
        resolution: 1024,
        margin: 4,
        fgMode: 'gradient',
        fg: '#182238',
        fg2: '#3c5378',
        angle: 45,
        bg: '#fdfdfc',
        transparent: false,
        dotStyle: 'rounded',
        eyeStyle: 'rounded',
        eyeCustom: false,
        eyeColor: '#182238',
        imageMode: 'logo',
        logoSize: 20,
        logoPadding: 6,
        logoShape: 'rounded',
        shapeTolerance: 18,
        shapeOpacity: 0,
        shapeExpand: 0,
        shapeInvert: false,
        shapeFit: 'contain',
        keepEyes: true,
        image: null
    };

    let silhouetteCache = null;
    let renderScheduled = false;
    let toastTimer = 0;
    let warnedSilhouette = false;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const setHidden = (el, hidden) => { if (el) el.classList.toggle('is-hidden', hidden); };
    const setText = (el, text) => { if (el) el.textContent = text; };

    /* ------------------------------------------------------------
       Contenido
       ------------------------------------------------------------ */

    function escapeWifi(value) {
        return String(value).replace(/([\\;,:"])/g, '\\$1');
    }

    function getPayload() {
        if (state.type === 'text') {
            return state.text.trim() || 'Hola desde QR Studio';
        }

        if (state.type === 'wifi') {
            const ssid = state.wifiSsid.trim() || 'MiRedWiFi';
            const password = state.wifiEnc === 'nopass' ? '' : state.wifiPass;
            let payload = 'WIFI:T:' + state.wifiEnc + ';S:' + escapeWifi(ssid) + ';';
            if (state.wifiEnc !== 'nopass') {
                payload += 'P:' + escapeWifi(password) + ';';
            }
            if (state.wifiHidden) {
                payload += 'H:true;';
            }
            return payload + ';';
        }

        let url = state.url.trim() || 'https://ejemplo.com';
        const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
        const specialScheme = /^(mailto|tel|sms|geo|bitcoin|data):/i.test(url);
        if (!hasProtocol && !specialScheme) {
            url = 'https://' + url;
        }
        return url;
    }

    /* ------------------------------------------------------------
       Matriz QR
       ------------------------------------------------------------ */

    function buildMatrix(payload, ecc) {
        const qr = qrcode(0, ecc);
        qr.addData(payload);
        qr.make();

        const n = qr.getModuleCount();
        const modules = new Uint8Array(n * n);

        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                modules[row * n + col] = qr.isDark(row, col) ? 1 : 0;
            }
        }

        return { n, modules, version: (n - 17) / 4 };
    }

    function isEyeCell(row, col, n) {
        return (row < 7 && col < 7) ||
            (row < 7 && col >= n - 7) ||
            (row >= n - 7 && col < 7);
    }

    function isCornerBlock(row, col, n) {
        return (row < 9 && col < 9) ||
            (row < 9 && col >= n - 9) ||
            (row >= n - 9 && col < 9);
    }

    function isTiming(row, col, n) {
        return (row === 6 && col >= 8 && col <= n - 9) ||
            (col === 6 && row >= 8 && row <= n - 9);
    }

    /* ------------------------------------------------------------
       Silueta de la imagen
       ------------------------------------------------------------ */

    function computeSilhouette(img, tolerance, invert, fit) {
        const canvas = document.createElement('canvas');
        canvas.width = MASK_RES;
        canvas.height = MASK_RES;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const iw = img.naturalWidth || img.width || MASK_RES;
        const ih = img.naturalHeight || img.height || MASK_RES;

        let drawW;
        let drawH;
        if (fit === 'cover') {
            const scale = Math.max(MASK_RES / iw, MASK_RES / ih);
            drawW = iw * scale;
            drawH = ih * scale;
        } else {
            const scale = Math.min(MASK_RES / iw, MASK_RES / ih);
            drawW = iw * scale;
            drawH = ih * scale;
        }

        const drawX = (MASK_RES - drawW) / 2;
        const drawY = (MASK_RES - drawH) / 2;

        ctx.clearRect(0, 0, MASK_RES, MASK_RES);
        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const pixels = ctx.getImageData(0, 0, MASK_RES, MASK_RES).data;

        // Color de fondo a partir de las esquinas visibles de la imagen.
        const pad = 4;
        const points = [
            [drawX + pad, drawY + pad],
            [drawX + drawW - pad, drawY + pad],
            [drawX + pad, drawY + drawH - pad],
            [drawX + drawW - pad, drawY + drawH - pad]
        ];
        let bg = null;
        const samples = [];

        for (const [px, py] of points) {
            const x = clamp(Math.round(px), 0, MASK_RES - 1);
            const y = clamp(Math.round(py), 0, MASK_RES - 1);
            const index = (y * MASK_RES + x) * 4;
            if (pixels[index + 3] > 200) {
                samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
            }
        }

        if (samples.length) {
            bg = { r: 0, g: 0, b: 0 };
            for (const sample of samples) {
                bg.r += sample[0];
                bg.g += sample[1];
                bg.b += sample[2];
            }
            bg.r = Math.round(bg.r / samples.length);
            bg.g = Math.round(bg.g / samples.length);
            bg.b = Math.round(bg.b / samples.length);
        }

        const threshold = tolerance * 1.6;
        const mask = new Uint8Array(MASK_RES * MASK_RES);

        for (let i = 0; i < MASK_RES * MASK_RES; i++) {
            const offset = i * 4;
            const alpha = pixels[offset + 3];
            let inside = alpha > 40;

            if (inside && bg && tolerance > 0) {
                const dist = Math.max(
                    Math.abs(pixels[offset] - bg.r),
                    Math.abs(pixels[offset + 1] - bg.g),
                    Math.abs(pixels[offset + 2] - bg.b)
                );
                inside = invert ? dist <= threshold : dist > threshold;
            }

            if (inside) mask[i] = 1;
        }

        return { res: MASK_RES, mask };
    }

    function getSilhouette() {
        if (!state.image || state.imageMode !== 'shape') return null;

        const cache = silhouetteCache;
        if (cache &&
            cache.img === state.image.img &&
            cache.tolerance === state.shapeTolerance &&
            cache.invert === state.shapeInvert &&
            cache.fit === state.shapeFit) {
            return cache.data;
        }

        try {
            const data = computeSilhouette(
                state.image.img,
                state.shapeTolerance,
                state.shapeInvert,
                state.shapeFit
            );
            silhouetteCache = {
                img: state.image.img,
                tolerance: state.shapeTolerance,
                invert: state.shapeInvert,
                fit: state.shapeFit,
                data
            };
            return data;
        } catch (error) {
            console.warn('No se pudo analizar la silueta:', error);
            if (!warnedSilhouette) {
                warnedSilhouette = true;
                showToast('No se pudo analizar la imagen. Prueba con un PNG.', 'error');
            }
            return null;
        }
    }

    function silhouetteAt(silhouette, row, col, n) {
        if (!silhouette) return true;
        if (silhouetteHas(silhouette, row, col, n)) return true;

        const expand = state.shapeExpand;
        if (!expand) return false;

        for (let dy = -expand; dy <= expand; dy++) {
            for (let dx = -expand; dx <= expand; dx++) {
                if (dx * dx + dy * dy > expand * expand) continue;
                if (silhouetteHas(silhouette, row + dy, col + dx, n)) return true;
            }
        }
        return false;
    }

    function silhouetteHas(silhouette, row, col, n) {
        if (row < 0 || col < 0 || row >= n || col >= n) return false;
        const x = clamp(Math.floor(((col + 0.5) / n) * silhouette.res), 0, silhouette.res - 1);
        const y = clamp(Math.floor(((row + 0.5) / n) * silhouette.res), 0, silhouette.res - 1);
        return silhouette.mask[y * silhouette.res + x] === 1;
    }

    /* ------------------------------------------------------------
       Pintura y formas
       ------------------------------------------------------------ */

    function gradientLine(size, angle) {
        const radians = (angle * Math.PI) / 180;
        const dx = Math.cos(radians);
        const dy = Math.sin(radians);
        const half = (Math.abs(dx) + Math.abs(dy)) * size / 2;
        const center = size / 2;

        return {
            x1: center - dx * half,
            y1: center - dy * half,
            x2: center + dx * half,
            y2: center + dy * half
        };
    }

    function createCanvasPaint(ctx, size) {
        if (state.fgMode === 'solid') return state.fg;

        const line = gradientLine(size, state.angle);
        const gradient = ctx.createLinearGradient(line.x1, line.y1, line.x2, line.y2);
        gradient.addColorStop(0, state.fg);
        gradient.addColorStop(1, state.fg2);
        return gradient;
    }

    function roundRectPath(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function classyPath(ctx, x, y, size, radius) {
        const r = Math.min(radius, size / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x + size, y + size - r);
        ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function drawModule(ctx, x, y, size, style, paint) {
        ctx.fillStyle = paint;

        if (style === 'dots') {
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, size * 0.5, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        if (style === 'rounded') {
            roundRectPath(ctx, x, y, size, size, size * 0.34);
            ctx.fill();
            return;
        }

        if (style === 'classy') {
            classyPath(ctx, x, y, size, size * 0.5);
            ctx.fill();
            return;
        }

        ctx.fillRect(x, y, size, size);
    }

    function drawEye(ctx, x, y, size, style, paint) {
        const total = size * 7;
        ctx.save();
        ctx.fillStyle = paint;
        ctx.strokeStyle = paint;
        ctx.lineWidth = size;
        ctx.lineJoin = 'round';

        if (style === 'circle') {
            const cx = x + total / 2;
            const cy = y + total / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, size * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy, size * 1.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            const outerRadius = style === 'rounded' ? size * 1.6 : 0;
            roundRectPath(ctx, x + size / 2, y + size / 2, size * 6, size * 6, outerRadius);
            ctx.stroke();

            const innerRadius = style === 'rounded' ? size * 0.7 : 0;
            roundRectPath(ctx, x + size * 2, y + size * 2, size * 3, size * 3, innerRadius);
            ctx.fill();
        }

        ctx.restore();
    }

    function drawLogo(ctx, size) {
        if (!state.image || state.imageMode !== 'logo') return;

        const image = state.image.img;
        const box = size * state.logoSize / 100;
        const padding = size * state.logoPadding / 100;
        const plate = box + padding * 2;
        const center = size / 2;
        const plateX = center - plate / 2;
        const plateY = center - plate / 2;

        const plateRadius = state.logoShape === 'circle'
            ? plate / 2
            : state.logoShape === 'rounded' ? plate * 0.26 : plate * 0.06;

        ctx.save();
        ctx.fillStyle = state.transparent ? '#ffffff' : state.bg;
        roundRectPath(ctx, plateX, plateY, plate, plate, plateRadius);
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)';
        ctx.lineWidth = Math.max(1, size * 0.0025);
        ctx.stroke();

        const imageX = center - box / 2;
        const imageY = center - box / 2;
        const imageRadius = state.logoShape === 'circle'
            ? box / 2
            : state.logoShape === 'rounded' ? box * 0.2 : 0;

        roundRectPath(ctx, imageX, imageY, box, box, imageRadius);
        ctx.clip();

        const iw = image.naturalWidth || image.width || box;
        const ih = image.naturalHeight || image.height || box;
        const scale = Math.max(box / iw, box / ih);
        const drawW = iw * scale;
        const drawH = ih * scale;

        ctx.drawImage(image, center - drawW / 2, center - drawH / 2, drawW, drawH);
        ctx.restore();
    }

    /* ------------------------------------------------------------
       Render en canvas
       ------------------------------------------------------------ */

    function renderCanvas(canvas, size, matrix, silhouette) {
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        const n = matrix.n;
        const margin = state.margin;
        const moduleSize = size / (n + margin * 2);
        const offset = margin * moduleSize;

        const paint = createCanvasPaint(ctx, size);
        const eyePaint = state.eyeCustom ? state.eyeColor : paint;

        const shapeMode = state.imageMode === 'shape' && !!silhouette;
        const customEyes = !shapeMode || state.keepEyes;
        const forceFunctionPatterns = shapeMode && state.keepEyes;

        if (!state.transparent) {
            ctx.fillStyle = state.bg;
            ctx.fillRect(0, 0, size, size);
        }

        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                if (!matrix.modules[row * n + col]) continue;
                if (customEyes && isEyeCell(row, col, n)) continue;

                if (shapeMode) {
                    const forced = forceFunctionPatterns &&
                        (isCornerBlock(row, col, n) || isTiming(row, col, n));
                    const inside = silhouetteAt(silhouette, row, col, n);
                    if (!forced && !inside) {
                        if (state.shapeOpacity <= 0) continue;
                        ctx.globalAlpha = state.shapeOpacity / 100;
                    }
                }

                drawModule(
                    ctx,
                    offset + col * moduleSize,
                    offset + row * moduleSize,
                    moduleSize,
                    state.dotStyle,
                    paint
                );

                if (shapeMode) {
                    ctx.globalAlpha = 1;
                }
            }
        }

        if (customEyes) {
            const eyes = [[0, 0], [0, n - 7], [n - 7, 0]];
            for (const [row, col] of eyes) {
                drawEye(
                    ctx,
                    offset + col * moduleSize,
                    offset + row * moduleSize,
                    moduleSize,
                    state.eyeStyle,
                    eyePaint
                );
            }
        }

        if (state.imageMode === 'logo') {
            drawLogo(ctx, size);
        }
    }

    /* ------------------------------------------------------------
       Exportación SVG
       ------------------------------------------------------------ */

    function svgEye(x, y, size, style, paint) {
        const total = size * 7;

        if (style === 'circle') {
            const cx = x + total / 2;
            const cy = y + total / 2;
            return '<circle cx="' + cx + '" cy="' + cy + '" r="' + size * 3 +
                '" fill="none" stroke="' + paint + '" stroke-width="' + size + '"/>' +
                '<circle cx="' + cx + '" cy="' + cy + '" r="' + size * 1.5 +
                '" fill="' + paint + '"/>';
        }

        const outerRadius = style === 'rounded' ? size * 1.6 : 0;
        const innerRadius = style === 'rounded' ? size * 0.7 : 0;

        return '<rect x="' + (x + size / 2) + '" y="' + (y + size / 2) +
            '" width="' + size * 6 + '" height="' + size * 6 +
            '" rx="' + outerRadius + '" fill="none" stroke="' + paint +
            '" stroke-width="' + size + '"/>' +
            '<rect x="' + (x + size * 2) + '" y="' + (y + size * 2) +
            '" width="' + size * 3 + '" height="' + size * 3 +
            '" rx="' + innerRadius + '" fill="' + paint + '"/>';
    }

    function buildSVG(size, matrix, silhouette) {
        const n = matrix.n;
        const margin = state.margin;
        const moduleSize = size / (n + margin * 2);
        const offset = margin * moduleSize;

        const shapeMode = state.imageMode === 'shape' && !!silhouette;
        const customEyes = !shapeMode || state.keepEyes;
        const forceFunctionPatterns = shapeMode && state.keepEyes;
        const paint = state.fgMode === 'gradient' ? 'url(#qr-gradient)' : state.fg;
        const eyePaint = state.eyeCustom ? state.eyeColor : paint;

        const parts = [];
        parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
            '" viewBox="0 0 ' + size + ' ' + size + '">');
        parts.push('<title>QR Studio</title>');

        if (state.fgMode === 'gradient') {
            const line = gradientLine(size, state.angle);
            parts.push('<defs><linearGradient id="qr-gradient" gradientUnits="userSpaceOnUse" x1="' +
                line.x1 + '" y1="' + line.y1 + '" x2="' + line.x2 + '" y2="' + line.y2 + '">' +
                '<stop offset="0" stop-color="' + state.fg + '"/>' +
                '<stop offset="1" stop-color="' + state.fg2 + '"/>' +
                '</linearGradient></defs>');
        }

        if (!state.transparent) {
            parts.push('<rect width="' + size + '" height="' + size + '" fill="' + state.bg + '"/>');
        }

        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                if (!matrix.modules[row * n + col]) continue;
                if (customEyes && isEyeCell(row, col, n)) continue;

                let alpha = 1;

                if (shapeMode) {
                    const forced = forceFunctionPatterns &&
                        (isCornerBlock(row, col, n) || isTiming(row, col, n));
                    const inside = silhouetteAt(silhouette, row, col, n);
                    if (!forced && !inside) {
                        if (state.shapeOpacity <= 0) continue;
                        alpha = state.shapeOpacity / 100;
                    }
                }

                const x = offset + col * moduleSize;
                const y = offset + row * moduleSize;
                const opacity = alpha < 1 ? ' fill-opacity="' + alpha + '"' : '';

                if (state.dotStyle === 'dots') {
                    parts.push('<circle cx="' + (x + moduleSize / 2) + '" cy="' + (y + moduleSize / 2) +
                        '" r="' + moduleSize * 0.5 + '" fill="' + paint + '"' + opacity + '/>');
                } else if (state.dotStyle === 'rounded') {
                    parts.push('<rect x="' + x + '" y="' + y + '" width="' + moduleSize +
                        '" height="' + moduleSize + '" rx="' + moduleSize * 0.34 +
                        '" fill="' + paint + '"' + opacity + '/>');
                } else if (state.dotStyle === 'classy') {
                    const r = moduleSize * 0.5;
                    const d = 'M' + (x + r) + ' ' + y +
                        'H' + (x + moduleSize) +
                        'V' + (y + moduleSize - r) +
                        'Q' + (x + moduleSize) + ' ' + (y + moduleSize) + ' ' + (x + moduleSize - r) + ' ' + (y + moduleSize) +
                        'H' + x +
                        'V' + (y + r) +
                        'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'Z';
                    parts.push('<path d="' + d + '" fill="' + paint + '"' + opacity + '/>');
                } else {
                    parts.push('<rect x="' + x + '" y="' + y + '" width="' + moduleSize +
                        '" height="' + moduleSize + '" fill="' + paint + '"' + opacity + '/>');
                }
            }
        }

        if (customEyes) {
            const eyes = [[0, 0], [0, n - 7], [n - 7, 0]];
            for (const [row, col] of eyes) {
                parts.push(svgEye(
                    offset + col * moduleSize,
                    offset + row * moduleSize,
                    moduleSize,
                    state.eyeStyle,
                    eyePaint
                ));
            }
        }

        if (state.imageMode === 'logo' && state.image) {
            const box = size * state.logoSize / 100;
            const padding = size * state.logoPadding / 100;
            const plate = box + padding * 2;
            const center = size / 2;
            const plateRadius = state.logoShape === 'circle'
                ? plate / 2
                : state.logoShape === 'rounded' ? plate * 0.26 : plate * 0.06;
            const imageRadius = state.logoShape === 'circle'
                ? box / 2
                : state.logoShape === 'rounded' ? box * 0.2 : 0;
            const plateColor = state.transparent ? '#ffffff' : state.bg;

            parts.push('<rect x="' + (center - plate / 2) + '" y="' + (center - plate / 2) +
                '" width="' + plate + '" height="' + plate + '" rx="' + plateRadius +
                '" fill="' + plateColor + '" stroke="rgba(15,23,42,0.12)" stroke-width="' +
                Math.max(1, size * 0.0025) + '"/>');

            parts.push('<defs><clipPath id="qr-logo-clip"><rect x="' + (center - box / 2) +
                '" y="' + (center - box / 2) + '" width="' + box + '" height="' + box +
                '" rx="' + imageRadius + '"/></clipPath></defs>');

            parts.push('<image href="' + state.image.src + '" x="' + (center - box / 2) +
                '" y="' + (center - box / 2) + '" width="' + box + '" height="' + box +
                '" preserveAspectRatio="xMidYMid slice" clip-path="url(#qr-logo-clip)"/>');
        }

        parts.push('</svg>');
        return parts.join('');
    }

    /* ------------------------------------------------------------
       Análisis de legibilidad
       ------------------------------------------------------------ */

    function hexToRgb(hex) {
        const value = String(hex).replace('#', '');
        const full = value.length === 3
            ? value.split('').map((char) => char + char).join('')
            : value;
        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16)
        };
    }

    function relativeLuminance(hex) {
        const rgb = hexToRgb(hex);
        const channel = (value) => {
            const v = value / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    }

    function contrastRatio(colorA, colorB) {
        const a = relativeLuminance(colorA);
        const b = relativeLuminance(colorB);
        const light = Math.max(a, b);
        const dark = Math.min(a, b);
        return (light + 0.05) / (dark + 0.05);
    }

    function contrastAnalysis() {
        const background = state.transparent ? '#ffffff' : state.bg;
        const colors = [state.fg];
        if (state.fgMode === 'gradient') colors.push(state.fg2);
        if (state.eyeCustom) colors.push(state.eyeColor);

        let worst = Infinity;
        for (const color of colors) {
            worst = Math.min(worst, contrastRatio(color, background));
        }

        let level = 'good';
        if (worst < 2.5) level = 'bad';
        else if (worst < 3.5) level = 'warn';

        return { ratio: worst, level };
    }

    function analyze(matrix, silhouette) {
        const n = matrix.n;
        const shapeMode = state.imageMode === 'shape' && !!silhouette;
        let darkModules = 0;
        let keptModules = 0;

        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                if (!matrix.modules[row * n + col]) continue;
                if (isEyeCell(row, col, n)) continue;

                darkModules++;

                if (!shapeMode) {
                    keptModules++;
                    continue;
                }

                const forced = state.keepEyes &&
                    (isCornerBlock(row, col, n) || isTiming(row, col, n));

                if (forced || silhouetteAt(silhouette, row, col, n)) {
                    keptModules++;
                }
            }
        }

        const ratio = darkModules ? keptModules / darkModules : 1;
        const innerRatio = Math.pow(n / (n + state.margin * 2), 2);
        const platePercent = (state.logoSize + state.logoPadding * 2) / 100;
        const logoDamage = state.image && state.imageMode === 'logo'
            ? clamp((platePercent * platePercent) / innerRatio, 0, 1)
            : 0;
        const rawDamage = shapeMode ? clamp(1 - ratio, 0, 1) : logoDamage;
        const support = shapeMode && state.shapeOpacity >= 100 ? 1 : 0;
        const damage = shapeMode ? rawDamage * (1 - support) : rawDamage;
        const capacity = { L: 0.07, M: 0.15, Q: 0.25, H: 0.30 }[state.ecc] || 0.30;
        const contrast = contrastAnalysis();

        let level = 'good';

        if (shapeMode) {
            if (damage > capacity * 0.65) level = 'bad';
            else if (damage > capacity * 0.30) level = 'warn';
        } else {
            if (damage > capacity * 0.9) level = 'bad';
            else if (damage > capacity * 0.6) level = 'warn';
        }

        if (contrast.level === 'bad') level = 'bad';
        else if (contrast.level === 'warn' && level === 'good') level = 'warn';

        return { ratio, damage, level, capacity, contrast };
    }

    /* ------------------------------------------------------------
       Interfaz
       ------------------------------------------------------------ */

    const el = (id) => document.getElementById(id);

    const PRESETS = {
        ink: { fg: '#182238', fg2: '#3c5378', bg: '#fdfdfc' },
        cobalt: { fg: '#1a3f74', fg2: '#0f6474', bg: '#fdfdfc' },
        forest: { fg: '#1c4433', fg2: '#3f5a1c', bg: '#fdfdfc' },
        plum: { fg: '#47243d', fg2: '#5f2b4c', bg: '#fdfdfc' },
        clay: { fg: '#542b1c', fg2: '#7a441e', bg: '#fbf7f2' }
    };

    const ECC_INFO = {
        L: { badge: 'Resistencia: 7%', hint: 'Corrección baja (7%). QR más compacto, menos tolerante a daños.' },
        M: { badge: 'Resistencia: 15%', hint: 'Corrección media (15%). Equilibrio entre tamaño y resistencia.' },
        Q: { badge: 'Resistencia: 25%', hint: 'Corrección alta (25%). Buena opción para impresión.' },
        H: { badge: 'Recomendado: H', hint: 'H resiste hasta un 30% de daño. Ideal si añades una imagen.' }
    };

    function showToast(message, type) {
        const toast = el('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.remove('is-success', 'is-error');
        if (type === 'success') toast.classList.add('is-success');
        if (type === 'error') toast.classList.add('is-error');
        toast.classList.add('is-visible');

        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3400);
    }

    function updateRange(input) {
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const value = Number(input.value);
        const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
        input.style.setProperty('--p', percent + '%');
    }

    function syncEcc() {
        $$('#eccChips .chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.ecc === state.ecc);
        });
        const info = ECC_INFO[state.ecc];
        setText(el('eccHint'), info.hint);
        setText(el('eccBadge'), info.badge);
    }

    function syncFgMode() {
        $$('#fgModeSeg button').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.fgmode === state.fgMode);
        });
        setHidden(el('fg2Field'), state.fgMode === 'solid');
        setHidden(el('angleRow'), state.fgMode === 'solid');
    }

    function syncPalette() {
        const active = state.fgMode === 'gradient'
            ? Object.keys(PRESETS).find((key) => {
                const preset = PRESETS[key];
                return preset.fg === state.fg && preset.fg2 === state.fg2 && preset.bg === state.bg;
            })
            : null;
        $$('#palettes .palette').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.preset === active);
        });
    }

    function syncColors() {
        el('fgColor').value = state.fg;
        el('fg2Color').value = state.fg2;
        el('bgColor').value = state.bg;
        el('eyeColor').value = state.eyeColor;

        setText(el('fgHex'), state.fg);
        setText(el('fg2Hex'), state.fg2);
        setText(el('bgHex'), state.bg);
        setText(el('eyeHex'), state.eyeColor);

        syncPalette();
    }

    function updateDropzone() {
        const hasImage = !!state.image;
        setHidden(el('dropzoneEmpty'), hasImage);
        setHidden(el('dropzonePreview'), !hasImage);

        if (hasImage) {
            el('imageThumb').src = state.image.src;
            setText(el('imageName'), state.image.name);
        }

        setText(el('imageModeBadge'), hasImage ? 'Activo' : 'Opcional');
    }

    function syncImageMode() {
        $$('#imageModeSeg button').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.imagemode === state.imageMode);
        });

        const isLogo = state.imageMode === 'logo';
        setHidden(el('logoControls'), !isLogo);
        setHidden(el('shapeControls'), isLogo);
        setText(el('modeHint'), isLogo
            ? 'Coloca tu logo en el centro sin perder legibilidad.'
            : 'Tu imagen define la silueta del QR. Ideal para logos con forma.');
        updateDropzone();
    }

    function syncOutputs() {
        setText(el('angleOutput'), state.angle + '°');
        setText(el('marginOutput'), state.margin + (state.margin === 1 ? ' módulo' : ' módulos'));
        setText(el('logoSizeOutput'), state.logoSize + '%');
        setText(el('logoPaddingOutput'), state.logoPadding + '%');
        setText(el('shapeToleranceOutput'), String(state.shapeTolerance));
        setText(el('shapeOpacityOutput'), state.shapeOpacity + '%');
        setText(el('shapeExpandOutput'), state.shapeExpand + (state.shapeExpand === 1 ? ' módulo' : ' módulos'));
        $$('input[type="range"]').forEach(updateRange);
    }

    function syncAll() {
        el('urlInput').value = state.url;
        el('textInput').value = state.text;
        el('wifiSsid').value = state.wifiSsid;
        el('wifiPass').value = state.wifiPass;
        el('wifiEnc').value = state.wifiEnc;
        el('wifiHidden').checked = state.wifiHidden;

        el('angleInput').value = state.angle;
        el('marginInput').value = state.margin;
        el('logoSize').value = state.logoSize;
        el('logoPadding').value = state.logoPadding;
        el('shapeTolerance').value = state.shapeTolerance;
        el('shapeOpacity').value = state.shapeOpacity;
        el('shapeExpand').value = state.shapeExpand;
        el('shapeFit').value = state.shapeFit;
        el('sizeSelect').value = String(state.resolution);

        el('eyeCustom').checked = state.eyeCustom;
        el('transparentToggle').checked = state.transparent;
        el('shapeInvert').checked = state.shapeInvert;
        el('keepEyes').checked = state.keepEyes;

        setHidden(el('eyeColorRow'), !state.eyeCustom);
        el('bgColorRow').classList.toggle('is-disabled', state.transparent);
        document.querySelector('.checker')?.classList.toggle('is-transparent', state.transparent);

        $$('#dotStyles .option-btn').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.style === state.dotStyle);
        });
        $$('#eyeStyles .option-btn').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.eye === state.eyeStyle);
        });
        $$('#logoShapes .option-btn').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.logoshape === state.logoShape);
        });

        syncColors();
        syncEcc();
        syncFgMode();
        syncImageMode();
        syncOutputs();
    }

    function queueRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            render();
        });
    }

    function byteLength(text) {
        try {
            return new TextEncoder().encode(text).length;
        } catch (error) {
            return unescape(encodeURIComponent(text)).length;
        }
    }

    function render() {
        const payload = getPayload();
        let matrix;

        try {
            matrix = buildMatrix(payload, state.ecc);
        } catch (error) {
            const banner = el('errorBanner');
            setHidden(banner, false);
            setText(el('errorText'), 'El contenido es demasiado largo para este nivel de corrección. Acorta el texto o elige un nivel menor.');
            // El aviso flotante solo cuando el banner en línea no se ve (móvil).
            const box = banner.getBoundingClientRect();
            if (box.bottom < 0 || box.top > window.innerHeight) {
                showToast('Contenido demasiado largo para el QR.', 'error');
            }
            return;
        }

        setHidden(el('errorBanner'), true);

        const silhouette = state.imageMode === 'shape' && state.image
            ? getSilhouette()
            : null;

        renderCanvas(el('qrCanvas'), PREVIEW_SIZE, matrix, silhouette);

        setText(el('qrVersion'), String(matrix.version));
        setText(el('qrModules'), matrix.n + ' × ' + matrix.n);
        setText(el('qrEcc'), state.ecc);
        setText(el('dataSize'), byteLength(payload) + ' B');

        const analysis = analyze(matrix, silhouette);
        updateLegibility(analysis);
        updateCoverage(analysis);
    }

    function updateLegibility(analysis) {
        const badge = el('scanStatus');
        badge.classList.remove('is-good', 'is-warn', 'is-bad');
        badge.classList.add('is-' + analysis.level);

        if (analysis.contrast.level === 'bad') {
            setText(el('scanStatusText'), 'Contraste bajo');
            setText(el('tipText'), 'El color del QR se parece demasiado al fondo. Usa un color más oscuro o un fondo más claro para que los lectores puedan distinguirlo.');
            return;
        }

        if (analysis.level === 'bad') {
            setText(el('scanStatusText'), 'Riesgo de escaneo');
            setText(el('tipText'), state.imageMode === 'shape'
                ? 'La silueta recorta demasiado el QR. Usa una forma más llena, aumenta el grosor de la silueta o activa las esquinas de lectura.'
                : 'La imagen cubre demasiado el QR. Reduce su tamaño o sube la corrección a H.');
            return;
        }

        if (analysis.contrast.level === 'warn') {
            setText(el('scanStatusText'), 'Contraste justo');
            setText(el('tipText'), 'El contraste es suficiente pero ajustado. Prueba el QR con varios móviles antes de imprimirlo.');
            return;
        }

        if (analysis.level === 'warn') {
            setText(el('scanStatusText'), 'Escaneo medio');
            setText(el('tipText'), state.imageMode === 'shape'
                ? 'La silueta recorta parte del código. Prueba con varios móviles; si falla, usa una silueta más llena o aumenta el grosor.'
                : 'La imagen reduce parte del código. Prueba con varios móviles y, si falla, reduce el tamaño del logo.');
            return;
        }

        setText(el('scanStatusText'), 'Escaneo óptimo');
        setText(el('tipText'), 'Prueba el QR con tu móvil antes de imprimirlo. Mantén un buen contraste entre los colores.');
    }

    function updateCoverage(analysis) {
        const bar = el('coverageBar');
        bar.classList.remove('is-warn', 'is-bad');

        if (state.imageMode !== 'shape') {
            setText(el('coverageValue'), 'Sin silueta');
            bar.style.transform = 'scaleX(0)';
            return;
        }

        const percent = Math.round(analysis.ratio * 100);
        setText(el('coverageValue'), percent + '%');
        bar.style.transform = 'scaleX(' + (percent / 100) + ')';

        if (analysis.level === 'warn') bar.classList.add('is-warn');
        if (analysis.level === 'bad') bar.classList.add('is-bad');
    }

    /* ------------------------------------------------------------
       Imagen
       ------------------------------------------------------------ */

    function readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Lectura fallida'));
            reader.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('No se pudo cargar la imagen'));
            image.src = src;
        });
    }

    async function handleImageFile(file) {
        if (!file.type || !file.type.startsWith('image/')) {
            showToast('Selecciona un archivo de imagen válido.', 'error');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            showToast('La imagen supera los 10 MB.', 'error');
            return;
        }

        try {
            const src = await readAsDataURL(file);
            const image = await loadImage(src);

            state.image = { img: image, src, name: file.name };
            silhouetteCache = null;
            warnedSilhouette = false;

            if (state.imageMode === 'shape' && state.ecc !== 'H') {
                state.ecc = 'H';
                syncEcc();
            }

            updateDropzone();
            render();
            showToast(state.imageMode === 'shape'
                ? 'Imagen lista: el QR tomará su forma.'
                : 'Logo añadido al centro del QR.', 'success');
        } catch (error) {
            console.error(error);
            showToast('No se pudo cargar la imagen. Prueba con otro archivo.', 'error');
        }
    }

    function removeImage() {
        state.image = null;
        silhouetteCache = null;
        updateDropzone();
        queueRender();
        showToast('Imagen eliminada.', 'info');
    }

    /* ------------------------------------------------------------
       Exportación
       ------------------------------------------------------------ */

    function createExportCanvas(size) {
        const matrix = buildMatrix(getPayload(), state.ecc);
        const silhouette = state.imageMode === 'shape' && state.image
            ? getSilhouette()
            : null;
        const canvas = document.createElement('canvas');
        renderCanvas(canvas, size, matrix, silhouette);
        return canvas;
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('No se pudo generar la imagen'));
            }, 'image/png');
        });
    }

    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async function downloadPng() {
        try {
            const canvas = createExportCanvas(state.resolution);
            const blob = await canvasToBlob(canvas);
            saveBlob(blob, 'qr-studio-' + Date.now() + '.png');
            showToast('PNG descargado a ' + state.resolution + ' px.', 'success');
        } catch (error) {
            console.error(error);
            showToast('No se pudo descargar el PNG.', 'error');
        }
    }

    function downloadSvg() {
        try {
            const matrix = buildMatrix(getPayload(), state.ecc);
            const silhouette = state.imageMode === 'shape' && state.image
                ? getSilhouette()
                : null;
            const svg = buildSVG(state.resolution, matrix, silhouette);
            saveBlob(
                new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
                'qr-studio-' + Date.now() + '.svg'
            );
            showToast('SVG descargado. Ideal para impresión.', 'success');
        } catch (error) {
            console.error(error);
            showToast('No se pudo descargar el SVG.', 'error');
        }
    }

    async function copyImage() {
        try {
            if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
                throw new Error('Clipboard no disponible');
            }

            const canvas = createExportCanvas(state.resolution);
            const blob = await canvasToBlob(canvas);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('Imagen copiada al portapapeles.', 'success');
        } catch (error) {
            console.warn(error);
            showToast('Tu navegador no permite copiar imágenes. Usa Descargar PNG.', 'error');
        }
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise((resolve, reject) => {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();

            try {
                document.execCommand('copy');
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                area.remove();
            }
        });
    }

    async function copyContent() {
        try {
            await copyText(getPayload());
            showToast('Contenido copiado. Pégalo donde quieras.', 'success');
        } catch (error) {
            showToast('No se pudo copiar el contenido.', 'error');
        }
    }

    function shareWhatsApp() {
        const payload = getPayload();
        window.open('https://wa.me/?text=' + encodeURIComponent(payload), '_blank', 'noopener');
    }

    /* ------------------------------------------------------------
       Eventos
       ------------------------------------------------------------ */

    function bindColor(inputId, hexId, onChange) {
        const input = el(inputId);
        input.addEventListener('input', () => {
            const value = input.value;
            setText(el(hexId), value);
            onChange(value);
            $$('#palettes .palette').forEach((palette) => palette.classList.remove('is-active'));
            queueRender();
        });
    }

    function bindRange(inputId, outputId, format, apply) {
        const input = el(inputId);
        const output = el(outputId);

        input.addEventListener('input', () => {
            const value = Number(input.value);
            apply(value);
            if (output) output.textContent = format(value);
            updateRange(input);
            queueRender();
        });
    }

    function bindOptionGroup(selector, dataKey, apply) {
        const buttons = $$(selector + ' .option-btn');
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                apply(button.dataset[dataKey]);
                buttons.forEach((item) => item.classList.toggle('is-active', item === button));
                queueRender();
            });
        });
    }

    function bindEvents() {
        // Tema
        el('themeToggle').addEventListener('click', () => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) metaTheme.setAttribute('content', next === 'dark' ? '#181b22' : '#f3f7f8');
            try {
                localStorage.setItem('qr-studio-theme', next);
            } catch (error) { /* almacenamiento no disponible */ }
        });

        // Tipo de contenido
        $$('.tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                state.type = tab.dataset.type;
                $$('.tab').forEach((item) => {
                    const active = item === tab;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-selected', String(active));
                });
                $$('.content-pane').forEach((pane) => {
                    pane.classList.toggle('is-active', pane.dataset.pane === state.type);
                });
                queueRender();
            });
        });

        el('urlInput').addEventListener('input', (event) => {
            state.url = event.target.value;
            queueRender();
        });

        el('textInput').addEventListener('input', (event) => {
            state.text = event.target.value;
            queueRender();
        });

        el('wifiSsid').addEventListener('input', (event) => {
            state.wifiSsid = event.target.value;
            queueRender();
        });

        el('wifiPass').addEventListener('input', (event) => {
            state.wifiPass = event.target.value;
            queueRender();
        });

        el('wifiEnc').addEventListener('change', (event) => {
            state.wifiEnc = event.target.value;
            queueRender();
        });

        el('wifiHidden').addEventListener('change', (event) => {
            state.wifiHidden = event.target.checked;
            queueRender();
        });

        // Corrección de errores
        $$('#eccChips .chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                state.ecc = chip.dataset.ecc;
                syncEcc();
                queueRender();
            });
        });

        // Color del QR
        $$('#fgModeSeg button').forEach((button) => {
            button.addEventListener('click', () => {
                state.fgMode = button.dataset.fgmode;
                syncFgMode();
                syncPalette();
                queueRender();
            });
        });

        bindColor('fgColor', 'fgHex', (value) => { state.fg = value; });
        bindColor('fg2Color', 'fg2Hex', (value) => { state.fg2 = value; });
        bindColor('bgColor', 'bgHex', (value) => { state.bg = value; });
        bindColor('eyeColor', 'eyeHex', (value) => { state.eyeColor = value; });

        // Paletas
        $$('#palettes .palette').forEach((button) => {
            button.addEventListener('click', () => {
                const preset = PRESETS[button.dataset.preset];
                if (!preset) return;

                state.fg = preset.fg;
                state.fg2 = preset.fg2;
                state.bg = preset.bg;
                state.fgMode = 'gradient';
                state.transparent = false;

                syncColors();
                syncFgMode();
                el('transparentToggle').checked = false;
                el('bgColorRow').classList.remove('is-disabled');
                queueRender();
            });
        });

        // Estilos
        bindOptionGroup('#dotStyles', 'style', (value) => { state.dotStyle = value; });
        bindOptionGroup('#eyeStyles', 'eye', (value) => { state.eyeStyle = value; });
        bindOptionGroup('#logoShapes', 'logoshape', (value) => { state.logoShape = value; });

        // Esquinas personalizadas
        el('eyeCustom').addEventListener('change', (event) => {
            state.eyeCustom = event.target.checked;
            setHidden(el('eyeColorRow'), !state.eyeCustom);
            queueRender();
        });

        // Fondo transparente
        el('transparentToggle').addEventListener('change', (event) => {
            state.transparent = event.target.checked;
            el('bgColorRow').classList.toggle('is-disabled', state.transparent);
            document.querySelector('.checker')?.classList.toggle('is-transparent', state.transparent);
            queueRender();
        });

        // Sliders
        bindRange('angleInput', 'angleOutput', (value) => value + '°', (value) => { state.angle = value; });
        bindRange('marginInput', 'marginOutput', (value) => value + (value === 1 ? ' módulo' : ' módulos'), (value) => { state.margin = value; });
        bindRange('logoSize', 'logoSizeOutput', (value) => value + '%', (value) => { state.logoSize = value; });
        bindRange('logoPadding', 'logoPaddingOutput', (value) => value + '%', (value) => { state.logoPadding = value; });
        bindRange('shapeTolerance', 'shapeToleranceOutput', (value) => String(value), (value) => {
            state.shapeTolerance = value;
            silhouetteCache = null;
        });
        bindRange('shapeOpacity', 'shapeOpacityOutput', (value) => value + '%', (value) => {
            state.shapeOpacity = value;
        });
        bindRange('shapeExpand', 'shapeExpandOutput', (value) => value + (value === 1 ? ' módulo' : ' módulos'), (value) => {
            state.shapeExpand = value;
        });

        // Modo de imagen
        $$('#imageModeSeg button').forEach((button) => {
            button.addEventListener('click', () => {
                state.imageMode = button.dataset.imagemode;
                syncImageMode();

                if (state.imageMode === 'shape' && state.image && state.ecc !== 'H') {
                    state.ecc = 'H';
                    syncEcc();
                    showToast('Corrección ajustada a H para que la silueta siga siendo escaneable.', 'info');
                }

                queueRender();
            });
        });

        // Ajuste de silueta
        el('shapeFit').addEventListener('change', (event) => {
            state.shapeFit = event.target.value;
            silhouetteCache = null;
            queueRender();
        });

        el('shapeInvert').addEventListener('change', (event) => {
            state.shapeInvert = event.target.checked;
            silhouetteCache = null;
            queueRender();
        });

        el('keepEyes').addEventListener('change', (event) => {
            state.keepEyes = event.target.checked;
            queueRender();
        });

        // Subida de imagen
        const dropzone = el('dropzone');
        const fileInput = el('imageFile');

        dropzone.addEventListener('click', (event) => {
            if (event.target.closest('#imageRemove')) return;
            fileInput.click();
        });

        dropzone.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) handleImageFile(file);
            event.target.value = '';
        });

        ['dragenter', 'dragover'].forEach((type) => {
            dropzone.addEventListener(type, (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropzone.classList.add('is-drag');
            });
        });

        ['dragleave', 'drop'].forEach((type) => {
            dropzone.addEventListener(type, (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (type === 'dragleave' && event.relatedTarget && dropzone.contains(event.relatedTarget)) return;
                dropzone.classList.remove('is-drag');
            });
        });

        dropzone.addEventListener('drop', (event) => {
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) handleImageFile(file);
        });

        el('imageRemove').addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            removeImage();
        });

        // Resolución y acciones
        el('sizeSelect').addEventListener('change', (event) => {
            state.resolution = Number(event.target.value);
            showToast('Resolución de exportación: ' + state.resolution + ' px.', 'info');
        });

        el('downloadPng').addEventListener('click', downloadPng);
        el('downloadSvg').addEventListener('click', downloadSvg);
        el('copyImage').addEventListener('click', copyImage);
        el('shareWhatsapp').addEventListener('click', shareWhatsApp);
        el('shareDiscord').addEventListener('click', copyContent);
    }

    /* ------------------------------------------------------------
       Inicio
       ------------------------------------------------------------ */

    function init() {
        setText(el('year'), String(new Date().getFullYear()));
        bindEvents();
        syncAll();
        render();
    }

    init();

})();
