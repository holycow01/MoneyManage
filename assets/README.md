# Assets

`icon.svg` and `splash.svg` are the design sources. Expo expects PNG files
at fixed paths — convert before building:

```bash
# 1024×1024 application icon
npx svgexport assets/icon.svg assets/icon.png 1024:1024
# 1024×1024 adaptive icon (Android — transparent background recommended)
npx svgexport assets/icon.svg assets/adaptive-icon.png 1024:1024
# Splash 1242×2688 (portrait, baked-in)
npx svgexport assets/splash.svg assets/splash.png 1242:2688
# Web favicon
npx svgexport assets/icon.svg assets/favicon.png 48:48
```

Or open the SVGs in Figma / Affinity / your tool of choice and export
manually. The paths above match `app.json`.
