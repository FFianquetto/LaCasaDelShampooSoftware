# La Casa del Shampoo — POS Escritorio

Software de escritorio Windows (instalable) para inventario por lotes, punto de venta, clientes, promociones e impresión de tickets.

## Stack

| Capa | Tecnología |
|------|------------|
| Shell | Tauri 2 |
| UI | React + TypeScript + Vite |
| API local | Node.js (Express) en `127.0.0.1:47831` |
| BD | SQLite (`%APPDATA%/LaCasaDelShampoo/`) |

## Requisitos

- Node.js 20+
- (Para instalador `.msi`/`.exe`) Rust + [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Arranque en desarrollo

```powershell
cd "C:\Users\cuale\Music\Fer_UANL\9no Semestre\0_Clientes\LaCasaDelShampoo\Software"

npm install
npm run build -w @lcds/shared
npm run build -w @lcds/db

# BD local del proyecto
$env:LCDS_DATA_DIR = "$PWD\data"
$env:LCDS_PRINT_MODE = "simulate"

npm run db:seed      # tiendas AME/HEN/CHI + usuarios
npm run db:import    # catálogo desde "Base de datos.xlsx"
```

Terminal 1 — API:

```powershell
$env:LCDS_DATA_DIR = "$PWD\data"
$env:LCDS_PRINT_MODE = "simulate"
npm run dev:server
```

Terminal 2 — UI:

```powershell
npm run dev:desktop
```

Abrir http://localhost:1420

### Credenciales

| Usuario | Contraseña | Rol / tienda |
|---------|------------|--------------|
| `admin` | `admin123` | Administrador (Americas) |
| `empame` | `emp123` | Empleado Americas |
| `emphen` | `emp123` | Empleado Henequen |
| `empchi` | `emp123` | Empleado Chihuahua |

### Consultar la BD SQLite

Archivo: `data\lacasadelshampoo.db`

- **DB Browser for SQLite:** abrir ese archivo.
- **Node:**

```powershell
node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database('data/lacasadelshampoo.db'); console.table(db.prepare('SELECT code,name FROM stores').all()); console.log('productos', db.prepare('SELECT COUNT(*) c FROM products').get()); db.close();"
```

### Reimportar Excel

```powershell
$env:LCDS_DATA_DIR = "$PWD\data"
npm run db:import
```

## Reglas de negocio clave

- Lote = código de barras; estados `Disponible` / `Vendido`.
- La venta **no se cierra** si falla la impresión del ticket (rollback).
- Empleado: POS + inventario de su sucursal (sin editar precios).
- Admin: precios, empleados, productos/lotes, promociones, sync 3 tiendas.
- Sync: archivos `.lcds` (export/import catálogo y reportes). Inventario local no se sobrescribe.

## Instalador Windows

Ver [installer/README.md](installer/README.md).

```bash
npm run tauri:build
```

Genera NSIS `.exe` y WiX `.msi` en `apps/desktop/src-tauri/target/release/bundle/`.

## Estructura

```
apps/desktop   # React + Tauri
apps/server    # API Node + SQLite
packages/shared
packages/db
installer/
docs/
```

## Fuera de alcance

CFDI/SAT, app móvil, terminales bancarias, sync en la nube.
