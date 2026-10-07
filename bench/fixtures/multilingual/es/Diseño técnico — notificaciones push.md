---
tags: [diseño, backend]
estado: borrador
---

# Diseño técnico — notificaciones push

## Problema

Los recordatorios de clase se envían hoy desde un cron cada cinco minutos. Si el proveedor falla, el recordatorio se pierde y nadie se entera.

## Propuesta

- Un servicio pequeño que lee los recordatorios pendientes y los publica en una cola de mensajes.
- Uno o varios workers consumen la cola y llaman a Firebase (Android) o a APNs (iOS).
- Cada mensaje guarda el número de intento. Los reintentos usan espera exponencial: 30 s, 2 min, 10 min, y después el mensaje va a una cola de errores para revisarlo a mano.

## Idempotencia

El identificador del recordatorio viaja en el mensaje. Si un worker se cae después de enviar pero antes de confirmar, el siguiente intento se descarta al ver que ya se envió.

## Métricas

- Tiempo entre la hora programada y la entrega real (p95 por debajo de 60 s).
- Porcentaje de mensajes en la cola de errores al día.

## Dudas

- ¿Basta con una sola cola o separamos por plataforma?
- ¿Cada cuánto limpiamos los tokens caducados?

Contexto en el [[Plan del proyecto — app de reservas]].
