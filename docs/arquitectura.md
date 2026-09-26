# Arquitectura — La Casa del Shampoo

Ver plan de implementación en el repositorio de planes Cursor.

## Resumen

- App Windows nativa (Tauri) + UI React/TS + sidecar Node + SQLite local.
- 3 sucursales independientes; sync por archivo `.lcds`.
- Venta transaccional con ticket obligatorio.

## Diagrama

```
[Lector HID] → [React UI] ↔ [Tauri] ↔ [Node API :47831] → [SQLite]
                                      ↓
                               [Impresora tickets]
```

## Módulos

Auth, Inventario/lotes, Productos/precios, Clientes, Promociones, POS, Tickets, Reportes, Sync, Config.
