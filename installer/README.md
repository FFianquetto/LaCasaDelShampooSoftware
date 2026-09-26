# Instalador Windows

## Productos de salida

- **NSIS** `.exe` — instalador por usuario
- **WiX** `.msi` — instalación empresarial

Configurados en `apps/desktop/src-tauri/tauri.conf.json` (`bundle.targets: ["nsis", "msi"]`).

## Pasos

1. Instalar [Rust](https://rustup.rs/) y prerequisitos Tauri (Visual Studio Build Tools, WebView2).
2. Preparar el sidecar Node:

```powershell
cd Soft\ware   # raíz del monorepo
npm run build:server
# Empaquetar server como binario portable (pkg / node + script)
# Copiar a apps/desktop/src-tauri/binaries/lcds-server-x86_64-pc-windows-msvc.exe
```

3. Generar iconos (si faltan):

```powershell
# Colocar icon.ico y PNGs en apps/desktop/src-tauri/icons/
```

4. Build:

```powershell
npm run tauri:build
```

5. Artefactos:

- `apps/desktop/src-tauri/target/release/bundle/nsis/`
- `apps/desktop/src-tauri/target/release/bundle/msi/`

## Datos en runtime

Tras instalar, la app usa:

- BD: `%APPDATA%\LaCasaDelShampoo\lacasadelshampoo.db`
- Tickets simulados/texto: `%APPDATA%\LaCasaDelShampoo\tickets\`
- Exports sync: `%APPDATA%\LaCasaDelShampoo\exports\`

## Impresión

- Desarrollo: `LCDS_PRINT_MODE=simulate` (escribe `.txt` del ticket).
- Producción: `LCDS_PRINT_MODE=system` (Out-Printer de Windows / impresora por defecto o térmica).

## Pruebas objetivo

- PC 8 GB RAM (ThinkPad)
- Lector USB HID
- Impresora de tickets
- Carga ≥ 3,000 movimientos/mes
