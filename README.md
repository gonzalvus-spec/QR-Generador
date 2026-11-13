<div align="center">
  <img src="img/logo.ico" alt="QR Studio" width="96">
</div>

# QR Studio

Generador de códigos QR profesional, rápido y privado. Crea QR con degradados, distintos estilos de módulos, logotipo central o con la silueta de tu propia imagen. Todo se procesa en el navegador: no se sube nada a ningún servidor.

## Características

- **Contenido flexible**: enlaces, texto libre y redes Wi-Fi (WPA/WEP/abierta, incluida red oculta).
- **Color directo al QR**: color sólido o degradado de dos colores con ángulo ajustable. El fondo se controla por separado.
- **Estilos de módulos**: suave, clásico, puntos y hoja.
- **Esquinas personalizables**: redondeadas, cuadradas o circulares, con color propio opcional.
- **Logo central**: sube un PNG, JPG, WEBP o SVG y elígelo redondeado, circular o cuadrado, con tamaño y espacio ajustables.
- **Forma del QR**: convierte la silueta de tu imagen en la forma del código. Incluye control de tolerancia de fondo, inversión, ajuste y datos de apoyo para mejorar el escaneo.
- **Corrección de errores L / M / Q / H** y análisis de legibilidad en tiempo real.
- **Exportación PNG** (512, 1024, 2048 o 4096 px), **SVG vectorial** para impresión y copia de la imagen al portapapeles.
- **Fondo transparente** para integrar el QR en cualquier diseño.
- **Tema claro y oscuro** con preferencia guardada.
- **100% local y sin dependencias de servidor**.

## Cómo usarlo

1. Abre `index.html` en tu navegador o sirve la carpeta con cualquier servidor estático.
2. Elige el tipo de contenido y escribe el enlace, texto o datos de la Wi-Fi.
3. Ajusta colores, estilo de módulos y esquinas desde **Diseño**.
4. Si quieres un logo, súbelo en **Imagen** y selecciona **Logo central**.
5. Para que el QR tome la forma de una imagen, selecciona **Forma del QR**.
6. Descarga el resultado en PNG o SVG.

También puedes ejecutarlo con un servidor local:

```bash
python -m http.server 8000
```

Y abrir `http://localhost:8000`.

## Forma del QR: consejos

La silueta recorta los módulos que quedan fuera de la imagen. Para conservar la legibilidad:

- Usa el nivel de corrección **H** (se activa automáticamente al elegir este modo).
- Prefiere siluetas llenas (círculos, escudos, cuadrados redondeados) frente a formas con muchos huecos.
- Mantén activada la opción **Conservar esquinas y líneas de lectura**.
- Si el QR no se escanea, sube **Grosor de la silueta** para engordar la forma y conservar más módulos, o activa **Datos de apoyo** para mostrar tenuemente los que quedan fuera.
- Prueba siempre el resultado con varios móviles antes de imprimirlo.

## Estructura

```text
QR-Generator/
├── css/
│   └── style.css
├── img/
│   └── logo.ico
├── js/
│   ├── qr.js          # Interfaz, renderizado y exportación
│   └── vendor/
│       └── qrcode.js  # Codificador QR local (qrcode-generator)
├── index.html
└── README.md
```

## Tecnología

HTML, CSS y JavaScript sin frameworks. El renderizado se hace con Canvas 2D y la exportación vectorial se genera directamente como SVG. La librería de codificación QR está incluida en el proyecto, por lo que funciona sin conexión.

## Créditos

Proyecto original de [Ballwictb](https://github.com/Ballwictb). fue rediseño y nuevas funciones de personalización por Rubritools.
