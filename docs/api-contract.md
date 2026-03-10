# Contrato API para contexto en tiempo real

Este documento define el formato recomendado para que `pwa-local-chat` consuma informacion actualizada (precios, mesas, stock) y la inyecte al modelo en cada pregunta.

## Reglas generales

- Formato de respuesta: `application/json`.
- Metodo recomendado: `GET`.
- Timestamp obligatorio: `updated_at` en ISO 8601 UTC.
- IDs estables para entidades (`id`, `table_id`, `sku`, etc.).
- Campos numericos reales para importes y cantidades.
- Incluir `available` o `status` cuando aplique.

## Estructura base recomendada

```json
{
  "updated_at": "2026-03-10T18:25:00Z",
  "source": "prices",
  "data": {}
}
```

Notas:
- `source` ayuda a auditar de donde vino el dato.
- `data` puede ser objeto o arreglo, segun el dominio.

## Endpoint: precios

URL sugerida: `/api/prices`

```json
{
  "updated_at": "2026-03-10T18:25:00Z",
  "source": "prices",
  "currency": "ARS",
  "data": {
    "items": [
      {
        "id": "cafe_latte",
        "name": "Cafe Latte",
        "price": 3800,
        "available": true,
        "category": "cafeteria"
      },
      {
        "id": "medialuna_manteca",
        "name": "Medialuna de manteca",
        "price": 1200,
        "available": false,
        "category": "panaderia"
      }
    ]
  }
}
```

## Endpoint: mesas ocupadas

URL sugerida: `/api/tables`

```json
{
  "updated_at": "2026-03-10T18:25:05Z",
  "source": "tables",
  "data": {
    "tables": [
      { "table_id": "A1", "status": "occupied", "seats": 4 },
      { "table_id": "A2", "status": "free", "seats": 2 },
      { "table_id": "B1", "status": "reserved", "seats": 6 }
    ],
    "summary": {
      "occupied": 8,
      "free": 5,
      "reserved": 2
    }
  }
}
```

Valores sugeridos para `status`:
- `free`
- `occupied`
- `reserved`
- `out_of_service`

## Endpoint: stock

URL sugerida: `/api/stock`

```json
{
  "updated_at": "2026-03-10T18:25:15Z",
  "source": "stock",
  "data": {
    "items": [
      {
        "sku": "LECHE-ALM-01",
        "name": "Leche de almendra",
        "qty": 7,
        "unit": "litro",
        "available": true
      },
      {
        "sku": "CROISSANT-01",
        "name": "Croissant",
        "qty": 0,
        "unit": "unidad",
        "available": false
      }
    ]
  }
}
```

## Codigos HTTP

- `200`: respuesta OK.
- `204`: sin contenido (evitar si el frontend espera JSON).
- `4xx`: error de cliente (endpoint invalido, auth, etc.).
- `5xx`: error de servidor.

Sugerencia de error JSON:

```json
{
  "updated_at": "2026-03-10T18:27:00Z",
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "No se pudo consultar el sistema de precios"
  }
}
```

## Integracion en la app

En Configuracion > Fuentes en tiempo real (API), cargar cada endpoint:

- Nombre: `Precios` | Endpoint: `https://tu-dominio/api/prices`
- Nombre: `Mesas` | Endpoint: `https://tu-dominio/api/tables`
- Nombre: `Stock` | Endpoint: `https://tu-dominio/api/stock`

La app consulta esas APIs antes de cada respuesta del bot y agrega los datos al contexto del modelo.
